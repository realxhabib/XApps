import { getOfficialApp } from "./catalog";
import type { AppCategory, AppManifest, Scoring } from "./types";

/**
 * First-party apps that were taken off the platform. Removing an app from
 * `OFFICIAL_APPS` retires it: `npm run sync-apps` sets its `public.apps` row
 * to `rejected` (never listed or playable again) and cancels its unfinished
 * matches, but the row, its finished matches and the XP they earned stay.
 * This list only keeps their names and colors, so that history (match cards,
 * results, the activity feed) still reads "Trivia Royale" instead of a slug.
 * Any other official slug the catalog no longer has falls back to a neutral
 * "Retired app".
 */
export interface RetiredApp {
  slug: string;
  name: string;
  icon: string;
  accent: [string, string];
  category: AppCategory;
  scoring: Scoring;
  maxPlayers: number;
}

export const RETIRED_APPS: readonly RetiredApp[] = [
  { slug: "hot-takes", name: "Hot Takes", icon: "🔥", accent: ["#ff9a3d", "#ff3d6e"], category: "debates", scoring: "votes", maxPlayers: 2 },
  { slug: "emoji-decode", name: "Emoji Decode", icon: "🧩", accent: ["#b6ff3d", "#1fd1b2"], category: "trivia", scoring: "high", maxPlayers: 2 },
  { slug: "trivia-royale", name: "Trivia Royale", icon: "👑", accent: ["#ffd84d", "#ff5c7a"], category: "trivia", scoring: "high", maxPlayers: 8 },
];

export function getRetiredApp(slug: string): RetiredApp | undefined {
  return RETIRED_APPS.find((app) => app.slug === slug);
}

export function isRetiredApp(slug: string): boolean {
  return !!getRetiredApp(slug);
}

/**
 * A never-playable stand-in manifest for a match whose app is gone (retired, or
 * no longer visible to this viewer): its name and colors when it's a known
 * retired app, otherwise a neutral "Retired app".
 */
export function retiredAppManifest(slug: string): AppManifest {
  const known = getRetiredApp(slug);
  return {
    slug,
    name: known?.name ?? "Retired app",
    tagline: "No longer on XApps.",
    description: "",
    category: known?.category ?? "games",
    icon: known?.icon ?? "🗃️",
    accent: known?.accent ?? ["#6b7285", "#343947"],
    url: "",
    kind: "game",
    modes: [],
    players: { min: 2, max: known?.maxPlayers ?? 8 },
    teams: 0,
    spectators: false,
    setup: false,
    turnBased: false,
    authority: "client",
    stats: [],
    achievements: [],
    scoring: known?.scoring ?? "high",
    durationLabel: "",
    howTo: [],
    official: !!known,
    developer: { id: null, handle: "xapps", name: "XApps Studio" },
    status: "rejected",
    retired: true,
    playCount: 0,
    upvotes: 0,
    upvoted: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    tags: [],
  };
}

/**
 * The app a match (or feed item) belongs to: the listed app, the catalog's, or
 * for a retired first-party app its stand-in. Undefined for an unknown slug.
 */
export function appForSlug(slug: string, apps?: readonly AppManifest[]): AppManifest | undefined {
  return apps?.find((a) => a.slug === slug) ?? getOfficialApp(slug) ?? (isRetiredApp(slug) ? retiredAppManifest(slug) : undefined);
}
