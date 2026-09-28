import { createRandom, randomId } from "@xapps/sdk";
import { BackendError, type Backend, type DemoControls, type RoomTransport } from "../backend";
import { OFFICIAL_APPS, getOfficialApp } from "../catalog";
import { XP } from "../scoring";
import type {
  AppManifest,
  CreateChallengeInput,
  Json,
  LeaderRow,
  Match,
  PlayableMode,
  Profile,
  RegisterAppInput,
  SubmitInput,
} from "../types";
import { createDemoRoom } from "./room";
import { PRACTICE_BOT_ID, addPersonaContest, applySettlement, buildSeed, newMatchId } from "./seed";
import {
  getViewerId,
  hydratePlayer,
  isHumanOnline,
  load,
  markHuman,
  mutate,
  mutateIfChanged,
  nowIso,
  reset,
  setSeeder,
  setViewerId,
  subscribe,
  type DemoDb,
  type MatchRow,
  type PlayerRow,
} from "./store";

setSeeder(buildSeed);

const SIM_LEADER_KEY = "xapps:demo-sim-leader";
const INVITED_KEY = "xapps:demo-invited";
const TAB_ID = randomId(8);
const SESSION_START = Date.now();

function hydrate(db: DemoDb, row: MatchRow): Match {
  return {
    id: row.id,
    appSlug: row.appSlug,
    mode: row.mode,
    status: row.status,
    scoring: row.scoring,
    seed: row.seed,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    winnerId: row.winnerId,
    isOpen: row.isOpen,
    settings: row.settings,
    votes: row.votes,
    votesNeeded: row.votesNeeded,
    votingEndsAt: row.votingEndsAt,
    simulatedVotes: row.simulatedVotes,
    players: row.players.map((p) => hydratePlayer(db, p)).sort((a, b) => a.seat - b.seat),
  };
}

function byRecent(a: MatchRow, b: MatchRow): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function appFor(db: DemoDb, slug: string): AppManifest | null {
  const official = getOfficialApp(slug);
  if (official) return { ...official, playCount: db.playCounts[slug] ?? 0 };
  return db.apps[slug] ?? null;
}

/** Mirrors create_challenge: an object, `quick` reserved. Demo allows room for a data-URL image. */
function challengeSettings(settings: CreateChallengeInput["settings"]): { [key: string]: Json } {
  if (!settings) return {};
  if (typeof settings !== "object" || Array.isArray(settings)) throw new BackendError("Challenge settings must be an object", "invalid");
  if (JSON.stringify(settings).length > 700_000) throw new BackendError("Challenge settings are too large", "invalid");
  const rest = { ...settings };
  delete rest.quick;
  return rest;
}

function newPlayer(userId: string, seat: number, extra: Partial<PlayerRow> = {}): PlayerRow {
  return {
    userId,
    seat,
    state: "joined",
    isBot: false,
    score: null,
    submission: null,
    result: null,
    xpDelta: 0,
    lastSeenAt: null,
    ...extra,
  };
}

/**
 * Local, zero-config backend. Every tab shares one localStorage database,
 * personas act as bots, and BroadcastChannel carries live match traffic.
 */
export class DemoBackend implements Backend {
  readonly kind = "demo" as const;
  private viewerListeners = new Set<(viewer: Profile | null) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      this.timer = setInterval(() => this.tick(), 1_200);
      // Keep our persona marked as human-controlled.
      const id = getViewerId();
      if (id) markHuman(id);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Session                                                          */
  /* ---------------------------------------------------------------- */

  async getViewer(): Promise<Profile | null> {
    const id = getViewerId();
    if (!id) return null;
    const profile = load().profiles[id];
    return profile ?? null;
  }

  onViewerChange(handler: (viewer: Profile | null) => void): () => void {
    this.viewerListeners.add(handler);
    // Profile edits (XP after a match) also count as viewer changes.
    const unsubscribe = subscribe(() => {
      const id = getViewerId();
      handler(id ? (load().profiles[id] ?? null) : null);
    });
    return () => {
      this.viewerListeners.delete(handler);
      unsubscribe();
    };
  }

  private async notifyViewer() {
    const viewer = await this.getViewer();
    this.viewerListeners.forEach((h) => h(viewer));
  }

  async signInWithX(): Promise<void> {
    throw new BackendError(
      "Sign in with X needs Supabase. Add your project keys to .env.local — or keep exploring the demo.",
      "invalid",
    );
  }

  async signOut(): Promise<void> {
    setViewerId(null);
    await this.notifyViewer();
  }

  readonly demo: DemoControls = {
    personas: () =>
      Object.values(load().profiles)
        .filter((p) => p.id !== PRACTICE_BOT_ID)
        .sort((a, b) => b.xp - a.xp),
    signInAs: async ({ handle, name }) => {
      const clean = handle.replace(/^@/, "").trim().toLowerCase();
      if (!/^[a-z0-9_]{2,15}$/.test(clean)) {
        throw new BackendError("Handles are 2–15 letters, numbers or underscores.", "invalid");
      }
      const profile = mutate((db) => {
        const existing = Object.values(db.profiles).find((p) => p.handle.toLowerCase() === clean);
        if (existing) return existing;
        const created: Profile = {
          id: `u-${randomId(10)}`,
          handle: clean,
          name: name?.trim() || clean,
          avatarUrl: null,
          bio: "Trying out XApps",
          xp: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          streak: 0,
          bestStreak: 0,
          createdAt: nowIso(),
        };
        db.profiles[created.id] = created;
        return created;
      });
      setViewerId(profile.id);
      markHuman(profile.id);
      await this.notifyViewer();
      return profile;
    },
    switchTo: async (profileId) => {
      if (!load().profiles[profileId]) throw new BackendError("No such persona", "not_found");
      setViewerId(profileId);
      markHuman(profileId);
      await this.notifyViewer();
    },
    reset: () => {
      reset();
      setViewerId(null);
      void this.notifyViewer();
    },
  };

  private requireViewer(): Profile {
    const id = getViewerId();
    const profile = id ? load().profiles[id] : undefined;
    if (!profile) throw new BackendError("Sign in to play", "unauthenticated");
    return profile;
  }

  /* ---------------------------------------------------------------- */
  /* Catalog                                                          */
  /* ---------------------------------------------------------------- */

  async listApps(): Promise<AppManifest[]> {
    const db = load();
    const viewerId = getViewerId();
    const community = Object.values(db.apps).filter(
      (app) => app.status === "published" || app.developer.id === viewerId,
    );
    return [...OFFICIAL_APPS.map((a) => ({ ...a, playCount: db.playCounts[a.slug] ?? 0 })), ...community];
  }

  async getApp(slug: string): Promise<AppManifest | null> {
    return appFor(load(), slug);
  }

  async registerApp(input: RegisterAppInput): Promise<AppManifest> {
    const viewer = this.requireViewer();
    return mutate((db) => {
      if (getOfficialApp(input.slug) || db.apps[input.slug]) {
        throw new BackendError("That slug is taken", "conflict");
      }
      const app: AppManifest = {
        ...input,
        players: { min: 2, max: 2 },
        votesToWin: input.scoring === "votes" ? 5 : undefined,
        durationLabel: "Community",
        official: false,
        developer: { id: viewer.id, handle: viewer.handle, name: viewer.name },
        // Demo mode auto-approves so you can try your app right away.
        status: "published",
        playCount: 0,
        createdAt: nowIso(),
        tags: ["community"],
      };
      db.apps[app.slug] = app;
      return app;
    });
  }

  async listMyApps(): Promise<AppManifest[]> {
    const viewerId = getViewerId();
    if (!viewerId) return [];
    return Object.values(load().apps).filter((a) => a.developer.id === viewerId);
  }

  /* ---------------------------------------------------------------- */
  /* People                                                           */
  /* ---------------------------------------------------------------- */

  async getProfile(handle: string): Promise<Profile | null> {
    const clean = handle.replace(/^@/, "").toLowerCase();
    return Object.values(load().profiles).find((p) => p.handle.toLowerCase() === clean) ?? null;
  }

  async searchProfiles(query: string): Promise<Profile[]> {
    const q = query.replace(/^@/, "").trim().toLowerCase();
    const viewerId = getViewerId();
    return Object.values(load().profiles)
      .filter((p) => p.id !== PRACTICE_BOT_ID && p.id !== viewerId)
      .filter((p) => !q || p.handle.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 8);
  }

  async leaderboard(appSlug?: string): Promise<LeaderRow[]> {
    const db = load();
    const people = Object.values(db.profiles).filter((p) => p.id !== PRACTICE_BOT_ID);
    const rows = people
      .map((profile) => {
        if (!appSlug) {
          return { profile, wins: profile.wins, played: profile.wins + profile.losses + profile.draws, xp: profile.xp };
        }
        const stats = db.appStats[`${appSlug}:${profile.id}`];
        return { profile, wins: stats?.wins ?? 0, played: stats?.played ?? 0, xp: stats?.xp ?? 0 };
      })
      .filter((row) => !appSlug || row.played > 0)
      .sort((a, b) => b.xp - a.xp || b.wins - a.wins);
    return rows.slice(0, 50).map((row, i) => ({ ...row, rank: i + 1 }));
  }

  /* ---------------------------------------------------------------- */
  /* Matches                                                          */
  /* ---------------------------------------------------------------- */

  private baseMatch(app: AppManifest, mode: PlayableMode, createdBy: string): MatchRow {
    const now = nowIso();
    return {
      id: newMatchId(),
      appSlug: app.slug,
      mode,
      status: "pending",
      scoring: app.scoring,
      seed: randomId(16),
      createdBy,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      endedAt: null,
      winnerId: null,
      isOpen: false,
      settings: {},
      votes: {},
      votesNeeded: app.votesToWin ?? 5,
      votingEndsAt: null,
      simulatedVotes: false,
      players: [],
    };
  }

  async createChallenge(input: CreateChallengeInput): Promise<Match> {
    const viewer = this.requireViewer();
    return mutate((db) => {
      const app = appFor(db, input.appSlug);
      if (!app) throw new BackendError("App not found", "not_found");
      if (!app.modes.includes(input.mode)) throw new BackendError(`${app.name} doesn't support ${input.mode} play`, "invalid");
      const row = this.baseMatch(app, input.mode, viewer.id);
      row.settings = challengeSettings(input.settings);
      row.players.push(newPlayer(viewer.id, 0));

      if (input.opponentHandle) {
        const handle = input.opponentHandle.replace(/^@/, "").toLowerCase();
        const opponent = Object.values(db.profiles).find((p) => p.handle.toLowerCase() === handle);
        if (!opponent) throw new BackendError(`@${handle} hasn't joined XApps yet`, "not_found");
        if (opponent.id === viewer.id) throw new BackendError("You can't challenge yourself", "invalid");
        // Personas nobody is playing right now are driven by the app as bots.
        const bot = !!opponent.isBot && !isHumanOnline(opponent.id);
        row.players.push(newPlayer(opponent.id, 1, { state: "invited", isBot: bot }));
        row.status = "pending";
      } else {
        row.isOpen = true;
        row.status = "open";
      }
      db.matches[row.id] = row;
      return hydrate(db, row);
    });
  }

  async uploadImage(image: Blob): Promise<string> {
    this.requireViewer();
    // Everything lives in localStorage here, so keep dropped images as small data URLs.
    if (image.size > 400_000) throw new BackendError("That image is too big for demo mode", "invalid");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new BackendError("Couldn't read that image", "invalid"));
      reader.readAsDataURL(image);
    });
  }

  async quickMatch(appSlug: string): Promise<Match> {
    const viewer = this.requireViewer();
    return mutate((db) => {
      const app = appFor(db, appSlug);
      if (!app) throw new BackendError("App not found", "not_found");
      const mode: PlayableMode = app.modes.includes("live") ? "live" : "async";
      const cutoff = Date.now() - 10 * 60_000;
      const waiting = Object.values(db.matches)
        .filter(
          (m) =>
            m.appSlug === appSlug &&
            m.status === "open" &&
            m.settings.quick === true &&
            m.createdBy !== viewer.id &&
            Date.parse(m.createdAt) > cutoff,
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (waiting) {
        waiting.players.push(newPlayer(viewer.id, 1));
        waiting.status = "active";
        waiting.isOpen = false;
        waiting.updatedAt = nowIso();
        return hydrate(db, waiting);
      }
      const row = this.baseMatch(app, mode, viewer.id);
      row.players.push(newPlayer(viewer.id, 0));
      row.status = "open";
      row.isOpen = true;
      row.settings = { quick: true };
      db.matches[row.id] = row;
      return hydrate(db, row);
    });
  }

  async startPractice(appSlug: string): Promise<Match> {
    const viewer = this.requireViewer();
    return mutate((db) => {
      const app = appFor(db, appSlug);
      if (!app) throw new BackendError("App not found", "not_found");
      const row = this.baseMatch(app, "practice", viewer.id);
      row.players.push(newPlayer(viewer.id, 0), newPlayer(PRACTICE_BOT_ID, 1, { isBot: true }));
      row.status = "active";
      row.simulatedVotes = app.scoring === "votes";
      row.votesNeeded = 5;
      db.matches[row.id] = row;
      return hydrate(db, row);
    });
  }

  private withMatch(matchId: string, fn: (db: DemoDb, row: MatchRow) => void): Match {
    return mutate((db) => {
      const row = db.matches[matchId];
      if (!row) throw new BackendError("Match not found", "not_found");
      fn(db, row);
      row.updatedAt = nowIso();
      return hydrate(db, row);
    });
  }

  async joinMatch(matchId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (_db, row) => {
      const me = row.players.find((p) => p.userId === viewer.id);
      if (me) {
        if (me.state === "invited") me.state = "joined";
      } else if (row.isOpen && row.status === "open" && row.players.length < 2) {
        row.players.push(newPlayer(viewer.id, row.players.length));
        row.isOpen = false;
      } else {
        throw new BackendError("This challenge is no longer open", "conflict");
      }
      if (["pending", "open"].includes(row.status) && row.players.length >= 2 && row.players.every((p) => p.state !== "invited")) {
        row.status = "active";
      }
    });
  }

  async declineMatch(matchId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (_db, row) => {
      const me = row.players.find((p) => p.userId === viewer.id);
      if (!me || me.state !== "invited") throw new BackendError("Nothing to decline", "invalid");
      me.state = "declined";
      row.status = "declined";
    });
  }

  async cancelMatch(matchId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (_db, row) => {
      if (row.createdBy !== viewer.id) throw new BackendError("Only the challenger can cancel", "forbidden");
      if (!["open", "pending"].includes(row.status)) throw new BackendError("Too late to cancel", "conflict");
      row.status = "cancelled";
    });
  }

  async getMatch(matchId: string): Promise<Match | null> {
    const db = load();
    const row = db.matches[matchId];
    return row ? hydrate(db, row) : null;
  }

  async markStarted(matchId: string): Promise<Match> {
    return this.withMatch(matchId, (_db, row) => {
      row.startedAt = row.startedAt ?? nowIso();
    });
  }

  async heartbeat(matchId: string): Promise<void> {
    const id = getViewerId();
    if (!id) return;
    markHuman(id);
    mutate((db) => {
      const p = db.matches[matchId]?.players.find((x) => x.userId === id);
      if (p) p.lastSeenAt = nowIso();
    });
  }

  async claimForfeit(matchId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      if (row.status !== "active" || !row.startedAt) throw new BackendError("Match isn't running", "conflict");
      const opponent = row.players.find((p) => p.userId !== viewer.id);
      if (!opponent || opponent.isBot) throw new BackendError("No opponent to claim against", "invalid");
      const seen = opponent.lastSeenAt ? Date.parse(opponent.lastSeenAt) : Date.parse(row.startedAt);
      if (Date.now() - seen < 45_000) throw new BackendError("Your opponent is still connected", "conflict");
      applySettlement(db, row, opponent.userId);
    });
  }

  async forfeit(matchId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      if (!["active", "pending", "open"].includes(row.status)) throw new BackendError("Match already over", "conflict");
      if (!row.players.some((p) => p.userId === viewer.id)) throw new BackendError("Not your match", "forbidden");
      if (row.players.length < 2) {
        row.status = "cancelled";
        return;
      }
      applySettlement(db, row, viewer.id);
    });
  }

  async submit(matchId: string, input: SubmitInput): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      const targetId = input.playerId ?? viewer.id;
      const target = row.players.find((p) => p.userId === targetId);
      if (!target) throw new BackendError("Not in this match", "forbidden");
      if (targetId !== viewer.id && !target.isBot) throw new BackendError("You can only submit for bots", "forbidden");
      if (!row.players.some((p) => p.userId === viewer.id)) throw new BackendError("Not in this match", "forbidden");
      if (["completed", "cancelled", "declined", "expired", "voting"].includes(row.status)) {
        throw new BackendError("This match is already decided", "conflict");
      }
      if (target.state === "submitted") throw new BackendError("Already submitted", "conflict");
      if (row.scoring !== "votes" && typeof input.score !== "number") {
        throw new BackendError("A score is required", "invalid");
      }
      target.state = "submitted";
      target.score = typeof input.score === "number" ? input.score : null;
      target.submission = { data: input.data, display: input.display };
      target.lastSeenAt = nowIso();

      const everyone = row.players.length >= 2 && row.players.every((p) => p.state === "submitted");
      if (!everyone) return;
      if (row.scoring === "votes") {
        row.status = "voting";
        row.votingEndsAt = new Date(Date.now() + (row.simulatedVotes ? 60_000 : 3 * 60_000)).toISOString();
        if (row.mode === "practice") row.simulatedVotes = true;
      } else {
        applySettlement(db, row);
      }
    });
  }

  async vote(matchId: string, choiceUserId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      if (row.status !== "voting") throw new BackendError("Voting is closed", "conflict");
      if (row.players.some((p) => p.userId === viewer.id)) throw new BackendError("You can't judge your own match", "forbidden");
      if (!row.players.some((p) => p.userId === choiceUserId)) throw new BackendError("Invalid choice", "invalid");
      if (db.votes.some((v) => v.matchId === matchId && v.voterId === viewer.id)) {
        throw new BackendError("You already voted", "conflict");
      }
      db.votes.push({ matchId, voterId: viewer.id, choiceId: choiceUserId, at: nowIso() });
      row.votes[choiceUserId] = (row.votes[choiceUserId] ?? 0) + 1;
      const me = db.profiles[viewer.id];
      if (me) me.xp += XP.vote;
      if ((row.votes[choiceUserId] ?? 0) >= row.votesNeeded) applySettlement(db, row);
    });
  }

  async listMyMatches(): Promise<Match[]> {
    const id = getViewerId();
    if (!id) return [];
    const db = load();
    return Object.values(db.matches)
      .filter((m) => m.players.some((p) => p.userId === id))
      .sort(byRecent)
      .slice(0, 60)
      .map((m) => hydrate(db, m));
  }

  async listVotingMatches(): Promise<Match[]> {
    const id = getViewerId();
    const db = load();
    const voted = new Set(db.votes.filter((v) => v.voterId === id).map((v) => v.matchId));
    return Object.values(db.matches)
      .filter((m) => m.status === "voting" && m.mode !== "practice" && !voted.has(m.id))
      .filter((m) => !id || !m.players.some((p) => p.userId === id))
      .sort(byRecent)
      .map((m) => hydrate(db, m));
  }

  async listRecentActivity(): Promise<Match[]> {
    const db = load();
    return Object.values(db.matches)
      .filter((m) => m.mode !== "practice" && ["completed", "voting", "active"].includes(m.status) && m.players.length >= 2)
      .sort(byRecent)
      .slice(0, 30)
      .map((m) => hydrate(db, m));
  }

  async listUserMatches(userId: string): Promise<Match[]> {
    const db = load();
    return Object.values(db.matches)
      .filter((m) => m.mode !== "practice" && m.players.some((p) => p.userId === userId))
      .filter((m) => ["completed", "voting", "active"].includes(m.status))
      .sort(byRecent)
      .slice(0, 20)
      .map((m) => hydrate(db, m));
  }

  /* ---------------------------------------------------------------- */
  /* Realtime                                                         */
  /* ---------------------------------------------------------------- */

  watchMatch(matchId: string, handler: (match: Match) => void): () => void {
    let last = "";
    const check = () => {
      const db = load();
      const row = db.matches[matchId];
      if (!row) return;
      const signature = JSON.stringify(row);
      if (signature === last) return;
      last = signature;
      handler(hydrate(db, row));
    };
    check();
    return subscribe(check);
  }

  watchInbox(handler: () => void): () => void {
    return subscribe(handler);
  }

  openRoom(matchId: string, viewerId: string): RoomTransport {
    return createDemoRoom(matchId, viewerId);
  }

  /* ---------------------------------------------------------------- */
  /* Storage                                                          */
  /* ---------------------------------------------------------------- */

  async storageGet(appSlug: string, key: string): Promise<Json | null> {
    const viewer = this.requireViewer();
    return load().storage[`${appSlug}:${viewer.id}:${key}`] ?? null;
  }

  async storageSet(appSlug: string, key: string, value: Json): Promise<void> {
    const viewer = this.requireViewer();
    mutate((db) => {
      db.storage[`${appSlug}:${viewer.id}:${key}`] = value;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Simulation: bots accept invites, fill lobbies and the crowd votes  */
  /* ---------------------------------------------------------------- */

  private isSimLeader(): boolean {
    try {
      const raw = localStorage.getItem(SIM_LEADER_KEY);
      const leader = raw ? (JSON.parse(raw) as { tab: string; at: number }) : null;
      if (!leader || leader.tab === TAB_ID || Date.now() - leader.at > 4_000) {
        localStorage.setItem(SIM_LEADER_KEY, JSON.stringify({ tab: TAB_ID, at: Date.now() }));
        return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  private tick(): void {
    const viewerId = getViewerId();
    if (viewerId) markHuman(viewerId);
    if (!this.isSimLeader()) return;

    const now = Date.now();
    mutateIfChanged((draft) => {
      let changed = false;
      const personas = Object.values(draft.profiles).filter((p) => p.isBot && p.id !== PRACTICE_BOT_ID);
      const humanInvolved = (row: MatchRow) => row.players.some((p) => !p.isBot || isHumanOnline(p.userId));

      for (const row of Object.values(draft.matches)) {
        const age = now - Date.parse(row.createdAt);

        // Bots accept invites after a short, human-feeling pause.
        if (row.status === "pending" && age > 1_800) {
          const invitedBot = row.players.find((p) => p.isBot && p.state === "invited");
          if (invitedBot) {
            invitedBot.state = "joined";
            if (row.players.every((p) => p.state !== "invited")) row.status = "active";
            row.updatedAt = nowIso();
            changed = true;
          }
        }

        // Nobody picked up the quick-match lobby — a persona hops in.
        if (row.status === "open" && row.settings.quick === true && age > 5_000 && row.players.length === 1) {
          const taken = new Set(row.players.map((p) => p.userId));
          const candidates = personas.filter((p) => !taken.has(p.id) && !isHumanOnline(p.id));
          const bot = candidates[Math.floor(Math.random() * candidates.length)];
          if (bot) {
            row.players.push(newPlayer(bot.id, 1, { isBot: true }));
            row.status = "active";
            row.isOpen = false;
            row.updatedAt = nowIso();
            changed = true;
          }
        }

        if (row.status !== "voting") continue;
        // The crowd trickles in: fast for your matches, slow for background ones.
        const deadlinePassed = row.votingEndsAt ? Date.parse(row.votingEndsAt) < now : false;
        const pace = row.mode === "practice" || row.simulatedVotes ? 0.7 : humanInvolved(row) ? 0.4 : 0.015;
        if (Math.random() < pace) {
          const already = new Set(draft.votes.filter((v) => v.matchId === row.id).map((v) => v.voterId));
          const voters = personas.filter(
            (p) => !already.has(p.id) && !row.players.some((pl) => pl.userId === p.id) && !isHumanOnline(p.id),
          );
          const voter = voters[Math.floor(Math.random() * voters.length)];
          if (voter) {
            // Slight preference for the longer, more effortful entry.
            const [a, b] = row.players;
            const weight = (p?: PlayerRow) => 1 + Math.min(1, JSON.stringify(p?.submission ?? "").length / 2_000);
            const choice = Math.random() * (weight(a) + weight(b)) < weight(a) ? a : b;
            if (choice) {
              draft.votes.push({ matchId: row.id, voterId: voter.id, choiceId: choice.userId, at: nowIso() });
              row.votes[choice.userId] = (row.votes[choice.userId] ?? 0) + 1;
              row.updatedAt = nowIso();
              changed = true;
              if ((row.votes[choice.userId] ?? 0) >= row.votesNeeded) applySettlement(draft, row);
            }
          }
        }
        if (row.status === "voting" && deadlinePassed) {
          applySettlement(draft, row);
          changed = true;
        }
      }

      // Keep the Arena stocked with fresh persona contests.
      const background = Object.values(draft.matches).filter(
        (m) => m.status === "voting" && !m.players.some((p) => !p.isBot),
      ).length;
      if (background < 4) {
        const rng = createRandom(randomId(8));
        addPersonaContest(draft, rng, rng.chance(0.5) ? "meme-duel" : "hot-takes", 0, true);
        changed = true;
      }

      // Once per session, a persona challenges the newcomer so invites can be seen live.
      if (viewerId && now - SESSION_START > 25_000 && !sessionStorage.getItem(INVITED_KEY)) {
        const viewer = draft.profiles[viewerId];
        const busy = Object.values(draft.matches).some(
          (m) => m.status === "pending" && m.players.some((p) => p.userId === viewerId && p.state === "invited"),
        );
        const challenger = personas.find((p) => p.id !== viewerId && !isHumanOnline(p.id));
        if (viewer && !viewer.isBot && !busy && challenger) {
          sessionStorage.setItem(INVITED_KEY, "1");
          const app = OFFICIAL_APPS.filter((a) => a.official)[Math.floor(Math.random() * 5)] ?? OFFICIAL_APPS[0]!;
          const mode: PlayableMode = app.modes.includes("async") ? "async" : "live";
          const row = this.baseMatch(app, mode, challenger.id);
          row.players.push(newPlayer(challenger.id, 0, { isBot: true }), newPlayer(viewerId, 1, { state: "invited" }));
          row.status = "pending";
          draft.matches[row.id] = row;
          changed = true;
        }
      }
      return changed;
    });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
