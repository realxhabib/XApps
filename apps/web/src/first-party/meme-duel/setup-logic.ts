/**
 * Pure side of Meme Duel's challenge setup screen (`xapps.purpose === "setup"`):
 * what the challenger picked, whether it can be submitted, the settings it
 * becomes (`roundToSettings`) and the one-line summary the invite shows.
 */
import { LIMITS, type Json } from "@xapps/sdk";
import { PHOTO_TEMPLATES, getPhotoTemplate, isPhotoTemplateId } from "./photo-templates";
import { TOPIC_MAX, parseRound, roundToSettings, type DropSlot, type MemeDrop, type MemeRound } from "./round";

export type SetupSource = "random" | "trending" | "template" | "drop";

/** One entry of `/api/trending-memes` (only the fields the setup screen uses). */
export interface TrendingPick {
  id: string;
  /** The format's name, e.g. "Two Buttons". */
  title: string;
  why?: string;
  /** The blank original. */
  src: string;
  width: number;
  height: number;
  credit: { handle: string; url: string } | null;
  imgflipId?: string;
  slots?: DropSlot[];
  examples?: string[];
}

export interface TrendingResponse {
  source: "grok" | "imgflip";
  memes: TrendingPick[];
}

/** Where a dropped image came from: the player's own upload, or a photo from an X post. */
export type DropOrigin = "upload" | "x";

export interface SetupDrop {
  drop: MemeDrop;
  origin: DropOrigin;
}

export interface SetupState {
  source: SetupSource;
  templateId: string | null;
  trending: TrendingPick | null;
  drop: SetupDrop | null;
  topic: string;
}

export const EMPTY_SETUP: SetupState = { source: "random", templateId: null, trending: null, drop: null, topic: "" };

export const SOURCE_LABEL: Record<SetupSource, string> = {
  random: "Surprise",
  trending: "Trending",
  template: "Classics",
  drop: "Drop one",
};

/** Every source but "random" needs a pick before it can be submitted. */
export function setupReady(state: SetupState): boolean {
  if (state.source === "drop") return !!state.drop;
  if (state.source === "template") return !!state.templateId;
  if (state.source === "trending") return !!state.trending;
  return true;
}

/** A trending pick as a round: a curated template when we have its caption layout, else a drop. */
export function trendingToRound(meme: TrendingPick): { templateId: string } | { drop: MemeDrop } {
  const templateId = meme.imgflipId ? `imgflip-${meme.imgflipId}` : null;
  if (templateId && isPhotoTemplateId(templateId)) return { templateId };
  return {
    drop: {
      src: meme.src,
      width: meme.width,
      height: meme.height,
      credit: meme.credit,
      name: meme.title,
      ...(meme.slots?.length ? { slots: meme.slots } : {}),
    },
  };
}

function cleanTopic(topic: string): string {
  return topic.replace(/\s+/g, " ").trim().slice(0, TOPIC_MAX);
}

/** The round the setup describes (only the active source counts). */
export function setupToRound(state: SetupState): MemeRound {
  const round: MemeRound = {};
  if (state.source === "template" && state.templateId) round.templateId = state.templateId;
  if (state.source === "trending" && state.trending) Object.assign(round, trendingToRound(state.trending));
  if (state.source === "drop" && state.drop) round.drop = state.drop.drop;
  const topic = cleanTopic(state.topic);
  if (topic) round.topic = topic;
  return round;
}

/** `match.settings` for `xapps.setup.submit`. */
export function setupToSettings(state: SetupState): { [key: string]: Json } {
  return roundToSettings(setupToRound(state));
}

/** UTF-8 size of the settings JSON (the host allows `LIMITS.setupSettingsBytes`). */
export function settingsBytes(settings: { [key: string]: Json }): number {
  return new TextEncoder().encode(JSON.stringify(settings)).length;
}

export function settingsFit(settings: { [key: string]: Json }): boolean {
  return settingsBytes(settings) <= LIMITS.setupSettingsBytes;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** What the picked meme is called, for the summary and the setup screen. */
export function pickName(state: SetupState): string | null {
  if (state.source === "template") return state.templateId ? (getPhotoTemplate(state.templateId)?.name ?? null) : null;
  if (state.source === "trending") return state.trending?.title ?? null;
  if (state.source === "drop" && state.drop) {
    const { drop, origin } = state.drop;
    if (drop.name) return drop.name;
    if (origin === "x") return drop.credit?.handle ? `@${drop.credit.handle.replace(/^@/, "")}` : "X photo";
    return null;
  }
  return null;
}

function sourceParts(state: SetupState): (string | null)[] {
  switch (state.source) {
    case "random":
      return ["Surprise template"];
    case "template":
      return ["Classic", pickName(state)];
    case "trending":
      return ["Trending", pickName(state)];
    case "drop": {
      const drop = state.drop?.drop;
      const handle = drop?.credit?.handle ? `@${drop.credit.handle.replace(/^@/, "")}` : null;
      return state.drop?.origin === "x" ? ["X photo", drop?.name ?? handle] : ["Dropped image", drop?.name ?? null];
    }
  }
}

/**
 * The line the invite shows, e.g. "Trending · Two Buttons · Topic: Monday mornings".
 * Always within `LIMITS.setupSummaryLength`.
 */
export function setupSummary(state: SetupState): string {
  const parts = sourceParts(state)
    .filter((p): p is string => !!p)
    .map((p) => clip(p, 40));
  const topic = cleanTopic(state.topic);
  if (topic) parts.push(`Topic: ${clip(topic, 60)}`);
  return clip(parts.join(" · "), LIMITS.setupSummaryLength);
}

/** The submit button's label: what's still missing, or what happens. */
export function setupActionLabel(state: SetupState, uploading = false): string {
  if (uploading) return "Uploading…";
  if (!setupReady(state)) return state.source === "drop" ? "Add an image first" : "Pick a meme";
  return state.source === "random" ? "Use a surprise meme" : "Use this meme";
}

/** Prefills the screen from settings submitted earlier (the host passes them back as `match.settings`). */
export function setupFromSettings(settings: { [key: string]: Json } | null | undefined): SetupState {
  const round = parseRound(settings);
  const state: SetupState = { ...EMPTY_SETUP, topic: round.topic ?? "" };
  if (round.drop) {
    const isX = /^https:\/\/pbs\.twimg\.com\//.test(round.drop.src) && !round.drop.name;
    return { ...state, source: "drop", drop: { drop: round.drop, origin: isX ? "x" : "upload" } };
  }
  if (round.templateId && isPhotoTemplateId(round.templateId)) return { ...state, source: "template", templateId: round.templateId };
  return state;
}

/** Photo templates in the Classics row. */
export const CLASSICS = PHOTO_TEMPLATES.filter((t) => !!t.photo);

export const TOPICS = [
  "Monday mornings",
  "Group chats",
  "When the Wi-Fi drops",
  "Your screen time report",
  "Replying 'lol' with a straight face",
  "The gym in January",
  "Airport security",
  "Your first job",
  "Reading the terms and conditions",
  "Unread emails",
  "Meetings that could've been an email",
  "Your phone at 1%",
  "Ordering food for the table",
  "Group projects",
  "Autocorrect",
  "Leaving a party",
  "Your algorithm",
  "Being 'on the way'",
  "Tech support for your parents",
  "Your camera roll",
];

/** A suggested topic other than the current one. */
export function suggestTopic(current: string, rand: () => number = Math.random): string {
  const options = TOPICS.filter((t) => t !== current);
  return options[Math.min(options.length - 1, Math.floor(rand() * options.length))]!;
}

/** imgflip serves small JPEG thumbnails under /4/, even for PNG templates. X photos have a `small` size. */
export function thumbSrc(src: string): string {
  if (src.startsWith("https://i.imgflip.com/")) {
    return src.replace("https://i.imgflip.com/", "https://i.imgflip.com/4/").replace(/\.(png|gif)$/i, ".jpg");
  }
  if (src.startsWith("https://pbs.twimg.com/media/") && !src.includes("?")) return `${src}?name=small`;
  return src;
}

/** Reads `/api/x-media`'s answer into a drop (throws with the route's message). */
export function xMediaToDrop(ok: boolean, body: unknown): MemeDrop {
  const b = (body && typeof body === "object" ? body : {}) as Partial<MemeDrop> & { error?: unknown };
  if (!ok || typeof b.src !== "string" || typeof b.width !== "number" || typeof b.height !== "number") {
    throw new Error(typeof b.error === "string" && b.error ? b.error : "Couldn't get that post");
  }
  const credit = b.credit && typeof b.credit.handle === "string" && typeof b.credit.url === "string" ? { handle: b.credit.handle, url: b.credit.url } : null;
  return { src: b.src, width: b.width, height: b.height, credit };
}
