import { createRandom, randomId } from "@xapps/sdk";
import { BOT_CAPTIONS, MEME_TEMPLATES, STICKERS } from "@/first-party/meme-duel/templates";
import { renderMemeSvg } from "@/first-party/meme-duel/render";
import { OFFICIAL_APPS } from "../catalog";
import { settle } from "../scoring";
import type { AppManifest, Profile } from "../types";
import { DB_VERSION, MATCH_V2_DEFAULTS, newPlayerRow, type DemoDb, type MatchRow, type PlayerRow } from "./store";
import { recordWebhook } from "./server-settings";

export const PRACTICE_BOT_ID = "bot-xapps";

const PERSONAS: Array<Pick<Profile, "id" | "handle" | "name" | "bio">> = [
  { id: "p-pixelqueen", handle: "pixelqueen", name: "Pixel Queen", bio: "memes are my love language 👑" },
  { id: "p-hotdogtheory", handle: "hotdogtheory", name: "Hot Dog Theory", bio: "a hot dog is a sandwich and I will die on this hill" },
  { id: "p-neon_nomad", handle: "neon_nomad", name: "Neon Nomad", bio: "reaction time: yes ⚡" },
  { id: "p-dadjokes_dan", handle: "dadjokes_dan", name: "Dan", bio: "I'm reading a book on anti-gravity. Can't put it down." },
  { id: "p-byte_bandit", handle: "byte_bandit", name: "Byte Bandit", bio: "four-in-a-row grandmaster (self-proclaimed)" },
  { id: "p-glyphgirl", handle: "glyphgirl", name: "Glyph", bio: "fluent in emoji 🧩" },
  { id: "p-takesmith", handle: "takesmith", name: "Take Smith", bio: "professional opinion haver" },
  { id: "p-mcgraw", handle: "quickdraw_mcgraw", name: "McGraw", bio: "fastest thumb on the timeline" },
  { id: "p-ratio_king", handle: "ratio_king", name: "Ratio King", bio: "I don't lose arguments, I lose friends" },
  { id: "p-lowkey_lena", handle: "lowkey_lena", name: "Lena", bio: "just here to vote tbh" },
];

function practiceBot(id: string, handle: string, name: string, bio: string): Profile {
  return {
    id,
    handle,
    name,
    avatarUrl: null,
    bio,
    xp: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    bestStreak: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    isBot: true,
  };
}

export const PRACTICE_BOT: Profile = practiceBot(
  PRACTICE_BOT_ID,
  "xapps_bot",
  "XApps Bot",
  "I practice so you don't have to lose in public.",
);

/** One distinct bot per practice seat (seat 1 is always the classic XApps Bot). */
export const PRACTICE_BOTS: Profile[] = [
  PRACTICE_BOT,
  practiceBot("bot-xapps-2", "bot_blip", "Blip", "Practice bot. Beeps when nervous."),
  practiceBot("bot-xapps-3", "bot_bloop", "Bloop", "Practice bot. Mostly harmless."),
  practiceBot("bot-xapps-4", "bot_zap", "Zap", "Practice bot. Fast, not smart."),
  practiceBot("bot-xapps-5", "bot_nova", "Nova", "Practice bot. Plays to win (sometimes)."),
  practiceBot("bot-xapps-6", "bot_gizmo", "Gizmo", "Practice bot. Has read the rules once."),
  practiceBot("bot-xapps-7", "bot_echo", "Echo", "Practice bot. Copies whoever's winning."),
];

const PRACTICE_BOT_IDS = new Set(PRACTICE_BOTS.map((b) => b.id));

/** Practice bots never show up as people (search, personas, leaderboards). */
export function isPracticeBot(id: string): boolean {
  return PRACTICE_BOT_IDS.has(id);
}

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

function player(userId: string, seat: number, extra: Partial<PlayerRow> = {}): PlayerRow {
  return newPlayerRow(userId, seat, { isBot: true, ...extra });
}

/** Community apps listed in demo mode, like any developer's (they aren't part of the first-party catalog). */
const SHOWCASE_DEVELOPER: Profile = {
  id: "p-realxhabib",
  handle: "realxhabib",
  name: "xhabib",
  avatarUrl: null,
  bio: "Building Starship League 🚀",
  xp: 1240,
  wins: 0,
  losses: 0,
  draws: 0,
  streak: 0,
  bestStreak: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
};

export const SHOWCASE_APPS: AppManifest[] = [
  {
    slug: "starship-league",
    name: "Starship League",
    tagline: "Rocket League in orbit. Bonk the Doge into the wormhole.",
    description:
      "Fly a Starship, boost, dodge and aerial to knock a sleeping Doge ball into the other team's wormhole goal. 1v1 up to 3v3 in low Earth orbit; bots fill empty ships. Three-minute matches with overtime.",
    category: "games",
    icon: "🚀",
    iconImage: "/showcase/starship-league-icon.webp",
    coverImage: "/showcase/starship-league-cover.webp",
    accent: ["#3b82f6", "#f97316"],
    url: "https://starshipleague.vercel.app/?xapps",
    modes: ["live", "practice"],
    players: { min: 2, max: 6 },
    teams: 2,
    spectators: false,
    setup: false,
    turnBased: false,
    stats: [
      { key: "goals", label: "Goals", aggregate: "sum" },
      { key: "saves", label: "Saves", aggregate: "sum" },
      { key: "demos", label: "Demolitions", aggregate: "sum" },
      { key: "wins", label: "Wins", aggregate: "sum" },
    ],
    achievements: [
      { id: "first_goal", name: "First goal", description: "Score your first goal", icon: "⚽", xp: 10 },
      { id: "hat_trick", name: "Hat trick", description: "Score three goals in one match", icon: "🎩", xp: 40 },
      { id: "demolition", name: "Demolition", description: "Blow up another Starship", icon: "💥", xp: 15 },
      { id: "clean_sheet", name: "Clean sheet", description: "Win without conceding", icon: "🧤", xp: 30 },
      { id: "overtime_hero", name: "Overtime hero", description: "Win a match in overtime", icon: "⏱️", xp: 25 },
    ],
    scoring: "high",
    durationLabel: "3 min",
    howTo: [
      "Both teams launch from the same kickoff spots.",
      "Drive, jump, boost and aerial to hit the Doge.",
      "More goals wins; ties go to overtime.",
    ],
    official: false,
    developer: { id: SHOWCASE_DEVELOPER.id, handle: SHOWCASE_DEVELOPER.handle, name: SHOWCASE_DEVELOPER.name },
    status: "published",
    playCount: 3_180,
    createdAt: "2026-09-29T00:00:00.000Z",
    tags: ["community", "3d"],
  },
];

/** Adds the showcase developer and apps to a demo database that doesn't have them. Returns whether it changed. */
export function ensureShowcase(db: DemoDb): boolean {
  let changed = false;
  if (!Object.values(db.profiles).some((p) => p.handle === SHOWCASE_DEVELOPER.handle)) {
    db.profiles[SHOWCASE_DEVELOPER.id] = { ...SHOWCASE_DEVELOPER };
    changed = true;
  }
  for (const app of SHOWCASE_APPS) {
    const existing = db.apps[app.slug];
    // Registered by hand before the showcase existed: give the owner's listing its art if it has none.
    if (existing && existing.developer.handle === app.developer.handle && !existing.iconImage && !existing.coverImage) {
      db.apps[app.slug] = { ...existing, iconImage: app.iconImage, coverImage: app.coverImage };
      changed = true;
    }
    if (existing || (db.showcaseSeeded ?? []).includes(app.slug)) continue;
    db.apps[app.slug] = structuredClone(app);
    (db.showcaseSeeded ??= []).push(app.slug);
    changed = true;
  }
  return changed;
}

/** Builds a fresh demo world: personas, match history, and contests waiting for votes. */
export function buildSeed(): DemoDb {
  const rng = createRandom("xapps-demo-world");
  const profiles: Record<string, Profile> = {};
  PERSONAS.forEach((persona, i) => {
    profiles[persona.id] = {
      ...persona,
      avatarUrl: null,
      xp: 180 + (PERSONAS.length - i) * 140 + rng.int(0, 90),
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      bestStreak: 0,
      createdAt: iso((40 - i) * 86_400_000),
      isBot: true,
    };
  });
  for (const bot of PRACTICE_BOTS) profiles[bot.id] = bot;

  const db: DemoDb = {
    version: DB_VERSION,
    profiles,
    apps: {},
    playCounts: Object.fromEntries(OFFICIAL_APPS.map((app) => [app.slug, rng.int(900, 4800)])),
    matches: {},
    votes: [],
    storage: {},
    appStats: {},
  };

  const ids = PERSONAS.map((p) => p.id);
  const scoreApps = OFFICIAL_APPS.filter((a) => a.scoring !== "votes" && a.official && a.kind !== "app");

  // 1) Finished score-based matches — history for feeds, profiles and leaderboards.
  for (let i = 0; i < 36; i++) {
    const app = rng.pick(scoreApps);
    const [a, b] = rng.shuffle(ids).slice(0, 2) as [string, string];
    const scoreFor = (): number => {
      if (app.slug === "quick-draw") return rng.int(0, 3);
      if (app.slug === "four-in-a-row") return rng.pick([0, 1]);
      if (app.slug === "eight-ball") return rng.pick([0, 1]);
      if (app.slug === "cup-pong") return rng.pick([0, 1]);
      if (app.slug === "darts") return rng.int(24, 72) * 5;
      if (app.slug === "mini-golf") return rng.int(22, 36);
      if (app.slug === "frontline") return rng.int(3, 20);
      return rng.int(0, 2);
    };
    let sa = scoreFor();
    let sb = scoreFor();
    if (app.slug === "four-in-a-row") sb = sa === 1 ? 0 : 1;
    if (app.slug === "eight-ball") sb = sa === 1 ? 0 : 1;
    if (app.slug === "cup-pong") sb = sa === 1 ? 0 : 1;
    if (app.slug === "quick-draw") {
      if (sa < 3 && sb < 3) {
        if (rng.chance(0.5)) sa = 3;
        else sb = 3;
      } else if (sa === 3 && sb === 3) {
        sb = 2;
      }
    }
    const ago = (i + 1) * rng.int(18, 70) * 60_000;
    const match: MatchRow = {
      id: `seed-${randomIdFrom(rng)}`,
      appSlug: app.slug,
      mode: "live",
      status: "completed",
      scoring: app.scoring,
      seed: randomIdFrom(rng),
      createdBy: a,
      createdAt: iso(ago + 180_000),
      updatedAt: iso(ago),
      startedAt: iso(ago + 150_000),
      endedAt: iso(ago),
      winnerId: null,
      isOpen: false,
      settings: {},
      votes: {},
      votesNeeded: 0,
      votingEndsAt: null,
      simulatedVotes: false,
      ...MATCH_V2_DEFAULTS,
      players: [
        player(a, 0, { state: "submitted", score: sa }),
        player(b, 1, { state: "submitted", score: sb }),
      ],
    };
    applySettlement(db, match);
    db.matches[match.id] = match;
  }

  // 2) Crowd-judged Meme Duels, some finished and some still collecting votes.
  const voting = [true, true, true, true, true, true, false, false];
  voting.forEach((stillVoting, i) => {
    addPersonaContest(db, rng, (i + 1) * rng.int(9, 40) * 60_000, stillVoting, i);
  });

  // 3) Perfect Circle (a standalone app, no matches): personas' own circles, so its worldwide board isn't empty.
  db.userStats ??= {};
  for (const id of ids) {
    const at = iso(rng.int(1, 96) * 3_600_000);
    const best = rng.int(862, 991) / 10;
    const drawn = rng.int(3, 160);
    db.userStats[`perfect-circle:${id}:best_circle`] = { value: best, updatedAt: at };
    db.userStats[`perfect-circle:${id}:circles_drawn`] = { value: drawn, updatedAt: at };
    if (best >= 98) db.userStats[`perfect-circle:${id}:perfect_circles`] = { value: rng.int(1, Math.min(6, drawn)), updatedAt: at };
  }

  // 4) Greg's Face (a standalone app too): personas' best faces, so its global board isn't empty.
  for (const [i, id] of ids.entries()) {
    const at = iso(rng.int(1, 120) * 3_600_000);
    const built = rng.int(2, 140);
    // Spread from ~99 % down to the high 70s, so the top of the board takes a near-perfect face.
    db.userStats[`gregs-face:${id}:best_face`] = { value: (994 - i * 22 - rng.int(0, 18)) / 10, updatedAt: at };
    db.userStats[`gregs-face:${id}:faces_built`] = { value: built, updatedAt: at };
    const perfect = rng.int(0, Math.min(9, Math.floor(built / 4)));
    if (perfect > 0) db.userStats[`gregs-face:${id}:perfect_parts`] = { value: perfect, updatedAt: at };
  }

  return db;
}

const PERSONA_IDS = PERSONAS.map((p) => p.id);

/**
 * A finished or still-voting Meme Duel between two personas, with real entries
 * rendered by the app's own content code. Used by the seed and to keep the
 * Arena stocked while the demo runs.
 */
export function addPersonaContest(
  db: DemoDb,
  rng: ReturnType<typeof createRandom>,
  agoMs: number,
  voting: boolean,
  variant = rng.int(0, 999),
): MatchRow {
  const [a, b] = rng.shuffle(PERSONA_IDS).slice(0, 2) as [string, string];
  const players = [player(a, 0, { state: "submitted" }), player(b, 1, { state: "submitted" })];
  const template = MEME_TEMPLATES[variant % MEME_TEMPLATES.length]!;
  const bank = BOT_CAPTIONS[template.id] ?? [];
  const settings: MatchRow["settings"] = { templateId: template.id };
  players.forEach((p, seat) => {
    const captions = bank[(variant + seat) % Math.max(1, bank.length)] ?? {};
    const entry = {
      templateId: template.id,
      captions,
      stickers: [
        { emoji: rng.pick(STICKERS), x: rng.float(0.15, 0.85), y: rng.float(0.25, 0.75), scale: rng.float(0.8, 1.3), rotate: rng.float(-20, 20) },
      ],
    };
    p.submission = {
      data: entry,
      display: { kind: "svg", svg: renderMemeSvg(entry), alt: `Meme: ${Object.values(captions).join(" / ")}` },
    };
  });

  const votesNeeded = 5;
  const va = voting ? rng.int(0, 3) : votesNeeded;
  const vb = voting ? rng.int(0, 3) : rng.int(1, 4);
  const match: MatchRow = {
    id: `seed-${randomIdFrom(rng)}`,
    appSlug: "meme-duel",
    mode: "async",
    status: voting ? "voting" : "completed",
    scoring: "votes",
    seed: randomIdFrom(rng),
    createdBy: a,
    createdAt: iso(agoMs + 3_600_000),
    updatedAt: iso(agoMs),
    startedAt: iso(agoMs + 3_500_000),
    endedAt: voting ? null : iso(agoMs),
    winnerId: null,
    isOpen: false,
    settings,
    votes: { [a]: va, [b]: vb },
    votesNeeded,
    votingEndsAt: voting ? new Date(Date.now() + 36 * 3_600_000).toISOString() : null,
    simulatedVotes: false,
    ...MATCH_V2_DEFAULTS,
    players,
  };
  const voters = PERSONA_IDS.filter((id) => id !== a && id !== b);
  rng
    .shuffle(voters)
    .slice(0, Math.min(voters.length, va + vb))
    .forEach((voterId, n) => db.votes.push({ matchId: match.id, voterId, choiceId: n < va ? a : b, at: iso(agoMs - n * 60_000) }));
  if (!voting) applySettlement(db, match);
  db.matches[match.id] = match;
  return match;
}

function randomIdFrom(rng: ReturnType<typeof createRandom>): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[rng.int(0, alphabet.length - 1)];
  return out;
}

/** Writes a settlement into the match row and updates player stats. */
export function applySettlement(db: DemoDb, match: MatchRow, forfeitBy?: string): void {
  if (forfeitBy) {
    const quitter = match.players.find((p) => p.userId === forfeitBy && p.role === "player");
    if (quitter && quitter.state !== "declined") quitter.state = "left";
  }
  // Like settle_match: multiplayer invites nobody answered are withdrawn, not ranked.
  if (match.maxPlayers > 2) match.players = match.players.filter((p) => !(p.role === "player" && p.state === "invited"));
  const { winnerId, winnerTeam, ranks, results, xp } = settle(
    { scoring: match.scoring, mode: match.mode, votes: match.votes, teams: match.teams, players: match.players },
    forfeitBy,
  );
  match.winnerId = winnerId;
  match.winnerTeam = winnerTeam;
  match.status = "completed";
  recordWebhook(db, match.appSlug, "match.ended", match.id);
  match.isOpen = false;
  match.turnDeadline = null;
  match.endedAt = match.endedAt ?? new Date().toISOString();
  match.updatedAt = new Date().toISOString();
  // Test builds (Stage 4) place players but never touch XP, records, app stats or the play count.
  const testBuild = !!match.versionId;
  if (!testBuild) db.playCounts[match.appSlug] = (db.playCounts[match.appSlug] ?? 0) + 1;

  for (const p of match.players) {
    if (!(p.userId in results)) continue;
    p.rank = ranks[p.userId] ?? null;
    p.result = results[p.userId] ?? null;
    p.xpDelta = testBuild ? 0 : (xp[p.userId] ?? 0);
    const profile = db.profiles[p.userId];
    if (!profile || isPracticeBot(p.userId) || testBuild) continue;
    profile.xp += p.xpDelta;
    if (match.mode === "practice") continue;
    if (p.result === "win") {
      profile.wins++;
      profile.streak++;
      profile.bestStreak = Math.max(profile.bestStreak, profile.streak);
    } else if (p.result === "loss") {
      profile.losses++;
      profile.streak = 0;
    } else {
      profile.draws++;
    }
    const key = `${match.appSlug}:${p.userId}`;
    const stats = db.appStats[key] ?? { played: 0, wins: 0, losses: 0, draws: 0, xp: 0 };
    stats.played++;
    stats.xp += p.xpDelta;
    if (p.result === "win") stats.wins++;
    else if (p.result === "loss") stats.losses++;
    else stats.draws++;
    db.appStats[key] = stats;
  }
}

/**
 * Upgrades a v3 demo database (1v1 only) to v4: every player gets a seat role,
 * matches get the v2 columns, and the extra practice bots join the world.
 */
export function upgradeDb(old: unknown): DemoDb | null {
  const db = old as { version?: number } & Partial<Omit<DemoDb, "version">>;
  if (!db || typeof db !== "object" || db.version !== 3 || !db.profiles || !db.matches) return null;
  const matches: Record<string, MatchRow> = {};
  for (const [id, raw] of Object.entries(db.matches)) {
    const row = raw as MatchRow;
    const completed = row.status === "completed";
    matches[id] = {
      ...MATCH_V2_DEFAULTS,
      ...row,
      maxPlayers: Math.max(2, row.players?.length ?? 2),
      players: (row.players ?? []).map((p) =>
        newPlayerRow(p.userId, p.seat, {
          ...p,
          team: null,
          role: "player",
          rank: completed && p.result ? (p.result === "loss" ? 2 : 1) : null,
        }),
      ),
    };
  }
  const profiles = { ...db.profiles };
  for (const bot of PRACTICE_BOTS) profiles[bot.id] = profiles[bot.id] ?? bot;
  return {
    version: DB_VERSION,
    profiles,
    apps: db.apps ?? {},
    playCounts: db.playCounts ?? {},
    matches,
    votes: db.votes ?? [],
    storage: db.storage ?? {},
    appStats: db.appStats ?? {},
  };
}

export function newMatchId(): string {
  return `m-${randomId(12)}`;
}
