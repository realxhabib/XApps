import { LIMITS } from "@xapps/sdk";
import type { AchievementDef, AppManifest, StatDef } from "./types";

const OFFICIAL_DEV = { id: null, handle: "xapps", name: "XApps Studio" };
const LAUNCH = "2026-09-01T00:00:00.000Z";

/**
 * First-party apps. They are built with the public @xapps/sdk exactly like
 * community apps — the only difference is that they are served from /embed.
 */
export const OFFICIAL_APPS: AppManifest[] = [
  {
    slug: "meme-duel",
    name: "Meme Duel",
    tagline: "Same template. Two captions. The crowd decides.",
    description:
      "Both players get the same template and a stack of stickers. Write the funniest caption, drag stickers into place, and submit. Your entry goes to the Arena where the crowd votes — first to the vote target wins.",
    category: "contests",
    icon: "🖼️",
    accent: ["#ff5ca8", "#8b5cff"],
    url: "/embed/meme-duel",
    modes: ["async", "live", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    // Meme Duel will render its own setup screen once it ships one (setup purpose).
    setup: false,
    turnBased: false,
    scoring: "votes",
    votesToWin: 5,
    durationLabel: "2 min + voting",
    howTo: [
      "You and your opponent get the same meme template.",
      "Write captions and drag up to three stickers onto the canvas.",
      "Submit — the Arena crowd votes until someone hits 5 votes.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: LAUNCH,
    tags: ["memes", "creative", "crowd-judged"],
  },
  {
    slug: "quick-draw",
    name: "Reflexes",
    tagline: "Wait for it… wait for it… GO.",
    description:
      "A best-of-five reflex duel. Hold steady while the tension builds, then tap the instant the signal fires. Tap early and you lose the round. Reaction times are measured on each device, so lag never decides a duel.",
    category: "games",
    icon: "⚡",
    accent: ["#ffe14d", "#ff7a1a"],
    url: "/embed/quick-draw",
    modes: ["live", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    // Meme Duel will render its own setup screen once it ships one (setup purpose).
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "~45 sec",
    howTo: [
      "Watch the screen. Don't touch anything while it says STEADY.",
      "The moment it flashes GO, tap as fast as you can.",
      "Faster reaction wins the round. First to three rounds takes the duel.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: LAUNCH,
    tags: ["reflex", "realtime", "1v1"],
  },
  {
    slug: "hot-takes",
    name: "Hot Takes",
    tagline: "Pick a side. Make your case. Get ratioed or crowned.",
    description:
      "A spicy prompt drops and each player is handed a side. You get 280 characters to make the most convincing — or most unhinged — argument. The crowd votes on who argued it better, not who they agree with.",
    category: "debates",
    icon: "🔥",
    accent: ["#ff9a3d", "#ff3d6e"],
    url: "/embed/hot-takes",
    modes: ["async", "live", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    // Meme Duel will render its own setup screen once it ships one (setup purpose).
    setup: false,
    turnBased: false,
    scoring: "votes",
    votesToWin: 5,
    durationLabel: "90 sec + voting",
    howTo: [
      "A prompt appears and you're assigned FOR or AGAINST.",
      "Write your take in 280 characters and set its spice level.",
      "The Arena votes on the better argument. First to 5 votes wins.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: LAUNCH,
    tags: ["debate", "writing", "crowd-judged"],
  },
  {
    slug: "four-in-a-row",
    name: "Four in a Row",
    tagline: "Drop, stack, connect. Live or over days.",
    description:
      "The timeless connect-four duel with buttery physics. Take turns dropping discs into a seven-column grid; connect four horizontally, vertically or diagonally to win. Play live on a 30-second clock, or play anytime and take your move whenever it suits you. Practice against a bot that actually thinks ahead.",
    category: "games",
    icon: "🔴",
    accent: ["#3d7bff", "#35e0ff"],
    url: "/embed/four-in-a-row",
    modes: ["live", "async", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    // Meme Duel will render its own setup screen once it ships one (setup purpose).
    setup: false,
    turnBased: true,
    scoring: "high",
    durationLabel: "~3 min",
    howTo: [
      "Players alternate dropping discs into any column.",
      "Line up four of your discs in any direction to win.",
      "Live: 30 seconds per move. Play anytime: up to 3 days per move, and we'll tell you when it's your turn.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: LAUNCH,
    tags: ["strategy", "turn-based", "classic"],
  },
  {
    slug: "emoji-decode",
    name: "Emoji Decode",
    tagline: "🧠 + ⚡ = you, probably. Race to decode.",
    description:
      "Eight emoji puzzles, eight seconds of panic each. Decode movies, idioms and phrases faster than your opponent — speed and accuracy both score. Play live to watch their progress, or async and chase their score.",
    category: "trivia",
    icon: "🧩",
    accent: ["#b6ff3d", "#1fd1b2"],
    url: "/embed/emoji-decode",
    modes: ["live", "async", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    // Meme Duel will render its own setup screen once it ships one (setup purpose).
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "~90 sec",
    howTo: [
      "Each round shows a string of emoji and four answers.",
      "Pick the right one — faster answers earn bonus points.",
      "Highest score after eight puzzles wins.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: LAUNCH,
    tags: ["trivia", "speed", "emoji"],
  },
  {
    slug: "trivia-royale",
    name: "Trivia Royale",
    tagline: "Up to 8 players. 8 rounds. One crown.",
    description:
      "A live trivia battle royale for 2–8 players. Everyone gets the same question at the same moment: lock in fast for more points, chain correct answers for streak bonuses, and watch the leaderboard reshuffle after every round. The final round scores double. Friends can drop in to spectate with live answer counts.",
    category: "trivia",
    icon: "👑",
    accent: ["#ffd84d", "#ff5c7a"],
    url: "/embed/trivia-royale",
    modes: ["live", "practice"],
    players: { min: 2, max: 8 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "~2 min",
    howTo: [
      "Everyone sees the same question with four answers and 12 seconds on the clock.",
      "Lock in fast: correct answers score up to 1,000, and streaks add up to +300.",
      "Eight rounds across science, geography, arts and more. The last one counts double.",
      "Highest total takes the crown.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: "2026-09-30T00:00:00.000Z",
    tags: ["trivia", "multiplayer", "party", "live"],
  },
  {
    slug: "rps-showdown",
    name: "RPS Showdown",
    tagline: "Rock, paper, scissors — best of three, no mercy.",
    description:
      "A community-style example app built with nothing but one HTML file and the public SDK bundle. Open its source to see how little code a head-to-head app needs.",
    category: "games",
    icon: "✊",
    accent: ["#9aa4ff", "#5b6bff"],
    url: "/examples/rps/index.html",
    modes: ["live", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    // Meme Duel will render its own setup screen once it ships one (setup purpose).
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "~30 sec",
    howTo: [
      "Both players secretly pick rock, paper or scissors.",
      "Picks are revealed at the same time.",
      "First to two round wins takes it.",
    ],
    official: false,
    developer: { id: null, handle: "xapps_examples", name: "SDK Examples" },
    status: "published",
    playCount: 0,
    createdAt: "2026-09-10T00:00:00.000Z",
    tags: ["example", "open-source", "vanilla-js"],
  },
];

/** Manifest defaults for the v2 fields (players 2–2, free for all, watchable, no setup, no turns, client-settled). */
export const MANIFEST_DEFAULTS = {
  players: { min: 2, max: 2 },
  teams: 0,
  spectators: true,
  setup: false,
  turnBased: false,
  authority: "client",
} as const;

/** Fills in any v2 manifest fields an older row or registration left out. */
export function withManifestDefaults(app: AppManifest): AppManifest {
  return {
    ...app,
    players: app.players ?? { ...MANIFEST_DEFAULTS.players },
    teams: app.teams ?? MANIFEST_DEFAULTS.teams,
    spectators: app.spectators ?? MANIFEST_DEFAULTS.spectators,
    setup: app.setup ?? MANIFEST_DEFAULTS.setup,
    turnBased: app.turnBased ?? MANIFEST_DEFAULTS.turnBased,
    authority: app.authority ?? MANIFEST_DEFAULTS.authority,
    stats: app.stats ?? [],
    achievements: app.achievements ?? [],
  };
}

export interface ManifestShape {
  players?: { min: number; max: number };
  teams?: number;
  spectators?: boolean;
  setup?: boolean;
  turnBased?: boolean;
  stats?: StatDef[];
  achievements?: AchievementDef[];
}

/**
 * Validates the multiplayer part of a manifest: 2 ≤ min ≤ max ≤ 8, teams 0 or
 * 2–4 with `max` a multiple of `teams`. Returns an error message, or null.
 */
export function manifestShapeError(shape: ManifestShape): string | null {
  const players = shape.players ?? MANIFEST_DEFAULTS.players;
  const { min, max } = players;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 2 || max > 8 || min > max) {
    return "Players must be a range within 2–8";
  }
  const teams = shape.teams ?? 0;
  if (teams !== 0 && (!Number.isInteger(teams) || teams < 2 || teams > 4)) return "Teams must be 0 or 2–4";
  if (teams && max % teams !== 0) return "Max players must be a multiple of the team count";
  return statDefsError(shape.stats) ?? achievementDefsError(shape.achievements);
}

/* ---------------------------------------------------------------------- */
/* Stats & achievements (Stage 3)                                         */
/* ---------------------------------------------------------------------- */

/** Stat keys and achievement ids. */
export const DEF_ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
export const STAT_AGGREGATES = ["max", "min", "sum", "last"] as const;
export const STAT_FORMATS = ["number", "ms", "percent"] as const;
export const DEF_LABEL_MAX = 40;
export const ACHIEVEMENT_DESCRIPTION_MAX = 140;
export const ACHIEVEMENT_XP_MAX = 100;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One emoji (a single grapheme with an emoji in it), e.g. "🏆", "👍🏽", "🇫🇷", "1️⃣". */
export function isSingleEmoji(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text !== value || text.length > 16) return false;
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(text)) return false;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const graphemes = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)];
    return graphemes.length === 1;
  }
  return true;
}

/** Validates manifest `stats` (≤ 8; unique keys like `best_time`). Returns an error message, or null. */
export function statDefsError(stats: unknown): string | null {
  if (stats === undefined || stats === null) return null;
  if (!Array.isArray(stats)) return "Stats must be a list";
  if (stats.length > LIMITS.maxStats) return `Up to ${LIMITS.maxStats} stats`;
  const keys = new Set<string>();
  for (const [i, stat] of stats.entries()) {
    const name = `Stat ${i + 1}`;
    if (!isPlainObject(stat)) return `${name} is malformed`;
    if (typeof stat.key !== "string" || !DEF_ID_PATTERN.test(stat.key)) {
      return `${name}: the key must start with a letter and use a–z, 0–9 or _ (max 32)`;
    }
    if (keys.has(stat.key)) return `${name}: the key "${stat.key}" is used twice`;
    keys.add(stat.key);
    if (typeof stat.label !== "string" || !stat.label.trim() || stat.label.length > DEF_LABEL_MAX) {
      return `${name}: the label must be 1–${DEF_LABEL_MAX} characters`;
    }
    if (!STAT_AGGREGATES.includes(stat.aggregate as never)) return `${name}: aggregate is max, min, sum or last`;
    if (stat.format !== undefined && !STAT_FORMATS.includes(stat.format as never)) {
      return `${name}: format is number, ms or percent`;
    }
  }
  return null;
}

/**
 * Validates manifest `achievements` (≤ 30, unique ids, one emoji, 0–100 XP,
 * ≤ 500 XP in total). `strictIcon: false` only checks the icon's length like
 * the database does (1–16 characters).
 */
export function achievementDefsError(achievements: unknown, { strictIcon = true } = {}): string | null {
  if (achievements === undefined || achievements === null) return null;
  if (!Array.isArray(achievements)) return "Achievements must be a list";
  if (achievements.length > LIMITS.maxAchievements) return `Up to ${LIMITS.maxAchievements} achievements`;
  const ids = new Set<string>();
  let total = 0;
  for (const [i, a] of achievements.entries()) {
    const name = `Achievement ${i + 1}`;
    if (!isPlainObject(a)) return `${name} is malformed`;
    if (typeof a.id !== "string" || !DEF_ID_PATTERN.test(a.id)) {
      return `${name}: the id must start with a letter and use a–z, 0–9 or _ (max 32)`;
    }
    if (ids.has(a.id)) return `${name}: the id "${a.id}" is used twice`;
    ids.add(a.id);
    if (typeof a.name !== "string" || !a.name.trim() || a.name.length > DEF_LABEL_MAX) {
      return `${name}: the name must be 1–${DEF_LABEL_MAX} characters`;
    }
    if (
      a.description !== undefined &&
      a.description !== null &&
      (typeof a.description !== "string" || a.description.length > ACHIEVEMENT_DESCRIPTION_MAX)
    ) {
      return `${name}: the description must be at most ${ACHIEVEMENT_DESCRIPTION_MAX} characters`;
    }
    const iconOk = strictIcon
      ? isSingleEmoji(a.icon)
      : typeof a.icon === "string" && a.icon.trim().length > 0 && a.icon.length <= 16;
    if (!iconOk) return `${name}: the icon must be one emoji`;
    if (!Number.isInteger(a.xp) || (a.xp as number) < 0 || (a.xp as number) > ACHIEVEMENT_XP_MAX) {
      return `${name}: XP must be a whole number from 0 to ${ACHIEVEMENT_XP_MAX}`;
    }
    if (a.secret !== undefined && typeof a.secret !== "boolean") return `${name}: secret must be true or false`;
    total += a.xp as number;
  }
  if (total > LIMITS.maxAchievementXpPerApp) {
    return `Achievements can award at most ${LIMITS.maxAchievementXpPerApp} XP in total (these add up to ${total})`;
  }
  return null;
}

/** Keeps the well-formed stat definitions of an untrusted list (e.g. an `apps.stats` row). */
export function toStatDefs(raw: unknown): StatDef[] {
  if (!Array.isArray(raw)) return [];
  const out: StatDef[] = [];
  for (const item of raw) {
    if (!isPlainObject(item) || statDefsError([item])) continue;
    if (out.some((s) => s.key === item.key)) continue;
    const def: StatDef = { key: item.key as string, label: item.label as string, aggregate: item.aggregate as StatDef["aggregate"] };
    if (item.format !== undefined) def.format = item.format as StatDef["format"];
    out.push(def);
  }
  return out.slice(0, LIMITS.maxStats);
}

/** Keeps the well-formed achievement definitions of an untrusted list (e.g. an `apps.achievements` row). */
export function toAchievementDefs(raw: unknown): AchievementDef[] {
  if (!Array.isArray(raw)) return [];
  const out: AchievementDef[] = [];
  for (const item of raw) {
    if (!isPlainObject(item) || achievementDefsError([item], { strictIcon: false })) continue;
    if (out.some((a) => a.id === item.id)) continue;
    const def: AchievementDef = {
      id: item.id as string,
      name: item.name as string,
      description: typeof item.description === "string" ? item.description : "",
      icon: item.icon as string,
      xp: item.xp as number,
    };
    if (item.secret === true) def.secret = true;
    out.push(def);
  }
  return out.slice(0, LIMITS.maxAchievements);
}

export function getOfficialApp(slug: string): AppManifest | undefined {
  return OFFICIAL_APPS.find((app) => app.slug === slug);
}

/** Resolves an app URL to an absolute URL and its origin. */
export function resolveAppUrl(url: string, base: string): { href: string; origin: string } {
  const resolved = new URL(url, base);
  return { href: resolved.toString(), origin: resolved.origin };
}
