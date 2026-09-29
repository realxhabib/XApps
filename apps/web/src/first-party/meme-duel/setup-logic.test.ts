import { LIMITS } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { entryToJson, resolveTemplate } from "./logic";
import { DROP_TEMPLATE_ID } from "./photo-templates";
import { isDemoMediaSrc, parseRound } from "./round";
import {
  EMPTY_SETUP,
  setupActionLabel,
  setupFromSettings,
  setupReady,
  setupSummary,
  setupToRound,
  setupToSettings,
  settingsBytes,
  settingsFit,
  suggestTopic,
  thumbSrc,
  trendingToRound,
  xMediaToDrop,
  type SetupState,
  type TrendingPick,
} from "./setup-logic";

const TWO_BUTTONS: TrendingPick = {
  id: "t1",
  title: "Two Buttons",
  src: "https://i.imgflip.com/1g8my4.jpg",
  width: 600,
  height: 908,
  credit: null,
  imgflipId: "87743020",
};

const GROK_FORMAT: TrendingPick = {
  id: "t2",
  title: "Distracted Cat",
  why: "Everyone's posting it",
  src: "https://pbs.twimg.com/media/Abc123.jpg",
  width: 1200,
  height: 800,
  credit: { handle: "someone", url: "https://x.com/someone/status/1" },
  slots: [{ id: "s1", label: "Cat", x: 0.1, y: 0.1, w: 0.3, h: 0.1, style: "impact" }],
};

const UPLOAD = "https://abc.supabase.co/storage/v1/object/public/app-media/meme-duel/11111111-1111-4111-8111-111111111111/x.jpg";
const DEMO_UPLOAD = "http://localhost:3000/api/demo-media/0123456789abcdef0123456789abcdef";

function state(patch: Partial<SetupState>): SetupState {
  return { ...EMPTY_SETUP, ...patch };
}

describe("setupReady / setupActionLabel", () => {
  it("lets a surprise go straight away and asks for a pick otherwise", () => {
    expect(setupReady(EMPTY_SETUP)).toBe(true);
    expect(setupActionLabel(EMPTY_SETUP)).toBe("Use a surprise meme");
    expect(setupReady(state({ source: "trending" }))).toBe(false);
    expect(setupActionLabel(state({ source: "template" }))).toBe("Pick a meme");
    expect(setupActionLabel(state({ source: "drop" }))).toBe("Add an image first");
    expect(setupReady(state({ source: "template", templateId: "imgflip-87743020" }))).toBe(true);
    expect(setupActionLabel(state({ source: "template", templateId: "imgflip-87743020" }))).toBe("Use this meme");
    expect(setupActionLabel(EMPTY_SETUP, true)).toBe("Uploading…");
  });
});

describe("setupToSettings", () => {
  it("only the active source counts", () => {
    const s = state({ source: "random", templateId: "imgflip-87743020", trending: TWO_BUTTONS, topic: "  Monday   mornings " });
    expect(setupToRound(s)).toEqual({ topic: "Monday mornings" });
    expect(setupToSettings(s)).toEqual({ topic: "Monday mornings" });
  });

  it("a trending pick with a curated template becomes a templateId", () => {
    expect(trendingToRound(TWO_BUTTONS)).toEqual({ templateId: "imgflip-87743020" });
    expect(setupToSettings(state({ source: "trending", trending: TWO_BUTTONS }))).toEqual({ templateId: "imgflip-87743020" });
  });

  it("other trending formats become drops with their name and placed boxes", () => {
    const settings = setupToSettings(state({ source: "trending", trending: GROK_FORMAT }));
    const round = parseRound(settings);
    expect(round.drop).toMatchObject({ src: GROK_FORMAT.src, width: 1200, height: 800, name: "Distracted Cat", credit: GROK_FORMAT.credit });
    expect(round.drop?.slots).toHaveLength(1);
  });

  it("an uploaded drop round-trips through parseRound (app-media and demo-media URLs)", () => {
    for (const src of [UPLOAD, DEMO_UPLOAD]) {
      const s = state({ source: "drop", drop: { drop: { src, width: 1080, height: 720, credit: null }, origin: "upload" }, topic: "Cats" });
      const round = parseRound(setupToSettings(s));
      expect(round).toEqual({ drop: { src, width: 1080, height: 720, credit: null }, topic: "Cats" });
      expect(resolveTemplate({ pick: (items) => items[0]! }, round).id).toBe(DROP_TEMPLATE_ID);
    }
  });

  it("stays well inside the 4 KB setup budget, even with six boxes and a long topic", () => {
    const slots = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, label: "A fairly long label", x: 0.1, y: i * 0.15, w: 0.5, h: 0.1, style: "label" as const }));
    const s = state({
      source: "trending",
      trending: { ...GROK_FORMAT, title: "x".repeat(60), slots },
      topic: "y".repeat(200),
    });
    const settings = setupToSettings(s);
    expect(settingsBytes(settings)).toBeLessThan(LIMITS.setupSettingsBytes / 2);
    expect(settingsFit(settings)).toBe(true);
    expect(settingsFit({ drop: { src: `data:image/jpeg;base64,${"A".repeat(5000)}`, width: 10, height: 10 } })).toBe(false);
  });
});

describe("setupSummary", () => {
  it("reads like the invite line", () => {
    expect(setupSummary(state({ source: "trending", trending: TWO_BUTTONS, topic: "Monday mornings" }))).toBe(
      "Trending · Two Buttons · Topic: Monday mornings",
    );
    expect(setupSummary(EMPTY_SETUP)).toBe("Surprise template");
    expect(setupSummary(state({ topic: "Group chats" }))).toBe("Surprise template · Topic: Group chats");
    expect(setupSummary(state({ source: "template", templateId: "imgflip-181913649" }))).toBe("Classic · Drake Hotline Bling");
    expect(setupSummary(state({ source: "drop", drop: { drop: { src: UPLOAD, width: 10, height: 10 }, origin: "upload" } }))).toBe("Dropped image");
    expect(
      setupSummary(
        state({
          source: "drop",
          drop: { drop: { src: "https://pbs.twimg.com/media/a.jpg", width: 10, height: 10, credit: { handle: "elonmusk", url: "u" } }, origin: "x" },
        }),
      ),
    ).toBe("X photo · @elonmusk");
  });

  it("clips long names and topics to fit the summary limit", () => {
    const summary = setupSummary(state({ source: "trending", trending: { ...TWO_BUTTONS, title: "T".repeat(300) }, topic: "z".repeat(79) }));
    expect(summary.length).toBeLessThanOrEqual(LIMITS.setupSummaryLength);
    expect(summary).toMatch(/^Trending · T+… · Topic: z+…$/);
  });
});

describe("setupFromSettings", () => {
  it("prefills from earlier settings", () => {
    expect(setupFromSettings({})).toEqual(EMPTY_SETUP);
    expect(setupFromSettings(null)).toEqual(EMPTY_SETUP);
    expect(setupFromSettings({ templateId: "imgflip-87743020", topic: "Cats" })).toEqual(
      state({ source: "template", templateId: "imgflip-87743020", topic: "Cats" }),
    );
    // Original (non-photo) templates aren't in the Classics row: fall back to a surprise.
    expect(setupFromSettings({ templateId: "nope" }).source).toBe("random");
    const x = setupFromSettings({ drop: { src: "https://pbs.twimg.com/media/a.jpg", width: 100, height: 80, credit: { handle: "a", url: "u" } } });
    expect(x.source).toBe("drop");
    expect(x.drop?.origin).toBe("x");
    const up = setupFromSettings({ drop: { src: DEMO_UPLOAD, width: 100, height: 80 } });
    expect(up.drop).toEqual({ drop: { src: DEMO_UPLOAD, width: 100, height: 80, credit: null }, origin: "upload" });
  });

  it("round-trips a setup through settings", () => {
    const s = state({ source: "template", templateId: "imgflip-181913649", topic: "Airport security" });
    expect(setupFromSettings(setupToSettings(s))).toEqual(s);
  });
});

describe("helpers", () => {
  it("suggestTopic never repeats the current topic", () => {
    for (let i = 0; i < 20; i++) expect(suggestTopic("Monday mornings", () => 0)).not.toBe("Monday mornings");
    expect(typeof suggestTopic("", () => 0.9999)).toBe("string");
  });

  it("thumbSrc asks for small images where the host has them", () => {
    expect(thumbSrc("https://i.imgflip.com/1g8my4.png")).toBe("https://i.imgflip.com/4/1g8my4.jpg");
    expect(thumbSrc("https://pbs.twimg.com/media/Abc.jpg")).toBe("https://pbs.twimg.com/media/Abc.jpg?name=small");
    expect(thumbSrc(UPLOAD)).toBe(UPLOAD);
  });

  it("xMediaToDrop reads the route's answer or its error", () => {
    expect(xMediaToDrop(true, { src: "https://pbs.twimg.com/media/a.jpg", width: 10, height: 20, credit: { handle: "a", url: "u" } })).toEqual({
      src: "https://pbs.twimg.com/media/a.jpg",
      width: 10,
      height: 20,
      credit: { handle: "a", url: "u" },
    });
    expect(() => xMediaToDrop(false, { error: "That post has no photo" })).toThrow("That post has no photo");
    expect(() => xMediaToDrop(true, null)).toThrow("Couldn't get that post");
  });
});

describe("demo-media drops", () => {
  it("accepts demo uploads (relative or absolute) but nothing else over http", () => {
    expect(isDemoMediaSrc("/api/demo-media/0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isDemoMediaSrc(DEMO_UPLOAD)).toBe(true);
    expect(isDemoMediaSrc(`${DEMO_UPLOAD}?x=1`)).toBe(false);
    expect(isDemoMediaSrc("http://evil.example/image.jpg")).toBe(false);
    expect(isDemoMediaSrc("http://user@evil.example/api/demo-media/0123456789abcdef0123456789abcdef")).toBe(false);
    expect(parseRound({ drop: { src: "http://evil.example/a.jpg", width: 100, height: 100 } }).drop).toBeUndefined();
  });

  it("entries keep a reference to the demo upload", () => {
    const round = parseRound({ drop: { src: DEMO_UPLOAD, width: 400, height: 300 } });
    const template = resolveTemplate({ pick: (items) => items[0]! }, round);
    const json = entryToJson({ templateId: template.id, captions: {}, stickers: [] }, template, round);
    expect(json.drop?.src).toBe(DEMO_UPLOAD);
  });
});
