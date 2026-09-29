import type { AppManifest } from "./types";

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
  };
}

export interface ManifestShape {
  players?: { min: number; max: number };
  teams?: number;
  spectators?: boolean;
  setup?: boolean;
  turnBased?: boolean;
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
  return null;
}

export function getOfficialApp(slug: string): AppManifest | undefined {
  return OFFICIAL_APPS.find((app) => app.slug === slug);
}

/** Resolves an app URL to an absolute URL and its origin. */
export function resolveAppUrl(url: string, base: string): { href: string; origin: string } {
  const resolved = new URL(url, base);
  return { href: resolved.toString(), origin: resolved.origin };
}
