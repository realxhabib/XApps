import { createRandom, randomId } from "@xapps/sdk";
import { BOT_CAPTIONS, MEME_TEMPLATES, STICKERS } from "@/first-party/meme-duel/templates";
import { renderMemeSvg } from "@/first-party/meme-duel/render";
import { HOT_TAKE_PROMPTS, hotTakeDisplay } from "@/first-party/hot-takes/prompts";
import { OFFICIAL_APPS } from "../catalog";
import { settle } from "../scoring";
import type { Profile } from "../types";
import type { DemoDb, MatchRow, PlayerRow } from "./store";

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

export const PRACTICE_BOT: Profile = {
  id: PRACTICE_BOT_ID,
  handle: "xapps_bot",
  name: "XApps Bot",
  avatarUrl: null,
  bio: "I practice so you don't have to lose in public.",
  xp: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  streak: 0,
  bestStreak: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  isBot: true,
};

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

function player(userId: string, seat: number, extra: Partial<PlayerRow> = {}): PlayerRow {
  return {
    userId,
    seat,
    state: "joined",
    isBot: true,
    score: null,
    submission: null,
    result: null,
    xpDelta: 0,
    lastSeenAt: null,
    ...extra,
  };
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
  profiles[PRACTICE_BOT_ID] = PRACTICE_BOT;

  const db: DemoDb = {
    version: 3,
    profiles,
    apps: {},
    playCounts: Object.fromEntries(OFFICIAL_APPS.map((app) => [app.slug, rng.int(900, 4800)])),
    matches: {},
    votes: [],
    storage: {},
    appStats: {},
  };

  const ids = PERSONAS.map((p) => p.id);
  const scoreApps = OFFICIAL_APPS.filter((a) => a.scoring !== "votes" && a.official);

  // 1) Finished score-based matches — history for feeds, profiles and leaderboards.
  for (let i = 0; i < 36; i++) {
    const app = rng.pick(scoreApps);
    const [a, b] = rng.shuffle(ids).slice(0, 2) as [string, string];
    const scoreFor = (): number => {
      if (app.slug === "quick-draw") return rng.int(0, 3);
      if (app.slug === "four-in-a-row") return rng.pick([0, 1]);
      if (app.slug === "emoji-decode") return rng.int(3, 15) * 100;
      return rng.int(0, 2);
    };
    let sa = scoreFor();
    let sb = scoreFor();
    if (app.slug === "four-in-a-row") sb = sa === 1 ? 0 : 1;
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
      players: [
        player(a, 0, { state: "submitted", score: sa }),
        player(b, 1, { state: "submitted", score: sb }),
      ],
    };
    applySettlement(db, match);
    db.matches[match.id] = match;
  }

  // 2) Crowd-judged contests, some finished and some still collecting votes.
  const contests: Array<{ slug: "meme-duel" | "hot-takes"; voting: boolean }> = [
    { slug: "meme-duel", voting: true },
    { slug: "hot-takes", voting: true },
    { slug: "meme-duel", voting: true },
    { slug: "hot-takes", voting: true },
    { slug: "meme-duel", voting: true },
    { slug: "hot-takes", voting: true },
    { slug: "meme-duel", voting: false },
    { slug: "hot-takes", voting: false },
  ];
  contests.forEach((contest, i) => {
    addPersonaContest(db, rng, contest.slug, (i + 1) * rng.int(9, 40) * 60_000, contest.voting, i);
  });

  return db;
}

const PERSONA_IDS = PERSONAS.map((p) => p.id);

/**
 * A finished or still-voting contest between two personas, with real entries
 * rendered by the apps' own content code. Used by the seed and to keep the
 * Arena stocked while the demo runs.
 */
export function addPersonaContest(
  db: DemoDb,
  rng: ReturnType<typeof createRandom>,
  slug: "meme-duel" | "hot-takes",
  agoMs: number,
  voting: boolean,
  variant = rng.int(0, 999),
): MatchRow {
  const [a, b] = rng.shuffle(PERSONA_IDS).slice(0, 2) as [string, string];
  const players = [player(a, 0, { state: "submitted" }), player(b, 1, { state: "submitted" })];
  let settings: MatchRow["settings"];

  if (slug === "meme-duel") {
    const template = MEME_TEMPLATES[variant % MEME_TEMPLATES.length]!;
    const bank = BOT_CAPTIONS[template.id] ?? [];
    settings = { templateId: template.id };
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
  } else {
    const prompt = HOT_TAKE_PROMPTS[variant % HOT_TAKE_PROMPTS.length]!;
    settings = { promptId: prompt.id };
    players.forEach((p, seat) => {
      const side = seat === 0 ? "for" : "against";
      const takes = side === "for" ? prompt.for : prompt.against;
      const entry = {
        promptId: prompt.id,
        side,
        take: takes[rng.int(0, takes.length - 1)] ?? "",
        spice: rng.pick([1, 2, 3] as const),
      } as const;
      p.submission = { data: { ...entry }, display: hotTakeDisplay(entry) };
    });
  }

  const votesNeeded = 5;
  const va = voting ? rng.int(0, 3) : votesNeeded;
  const vb = voting ? rng.int(0, 3) : rng.int(1, 4);
  const match: MatchRow = {
    id: `seed-${randomIdFrom(rng)}`,
    appSlug: slug,
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
  const hydrated = {
    scoring: match.scoring,
    mode: match.mode,
    votes: match.votes,
    players: match.players.map((p) => ({ ...p, profile: db.profiles[p.userId]! })),
  };
  const { winnerId, results, xp } = settle(hydrated, forfeitBy);
  match.winnerId = winnerId;
  match.status = "completed";
  match.endedAt = match.endedAt ?? new Date().toISOString();
  match.updatedAt = new Date().toISOString();
  db.playCounts[match.appSlug] = (db.playCounts[match.appSlug] ?? 0) + 1;

  for (const p of match.players) {
    p.result = results[p.userId] ?? null;
    p.xpDelta = xp[p.userId] ?? 0;
    const profile = db.profiles[p.userId];
    if (!profile || p.userId === PRACTICE_BOT_ID) continue;
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

export function newMatchId(): string {
  return `m-${randomId(12)}`;
}
