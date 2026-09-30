import { LIMITS } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { isAllowedMemeSource, memeImageUrl } from "./meme-image";
import {
  bytesMatchMime,
  demoMediaId,
  displayProblem,
  formatStat,
  isAllowedMediaUrl,
  mediaKindOf,
  mediaProblem,
  mediaQuotaProblem,
  shareLinkFor,
  shareableImageKey,
} from "./media";

const SB = "https://proj.supabase.co";
const USER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const FILE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const APP_MEDIA = `${SB}/storage/v1/object/public/app-media/meme-duel/${USER}/${FILE}.png`;
const DEMO_ID = "0123456789abcdef0123456789abcdef";
const ORIGIN = "http://localhost:3000";

describe("isAllowedMediaUrl", () => {
  const sb = { supabaseUrl: SB, origin: ORIGIN };
  const demo = { supabaseUrl: "", origin: ORIGIN };

  it("accepts our app-media public URLs", () => {
    expect(isAllowedMediaUrl(APP_MEDIA, sb)).toBe(true);
    expect(isAllowedMediaUrl(`${SB}/storage/v1/object/public/app-media/my-app/${USER}/clip.mp4`, sb)).toBe(true);
  });

  it("rejects other buckets, hosts, folders and decorated URLs", () => {
    for (const url of [
      `${SB}/storage/v1/object/public/meme-drops/${USER}/${FILE}.png`,
      `https://evil.test/storage/v1/object/public/app-media/meme-duel/${USER}/${FILE}.png`,
      `${SB}/storage/v1/object/public/app-media/meme-duel/${FILE}.png`,
      `${SB}/storage/v1/object/public/app-media/meme-duel/${USER}/sub/${FILE}.png`,
      `${SB}/storage/v1/object/public/app-media/Meme_Duel/${USER}/${FILE}.png`,
      `${APP_MEDIA}?download=1`,
      `${APP_MEDIA}#x`,
      `https://user:pw@proj.supabase.co/storage/v1/object/public/app-media/meme-duel/${USER}/${FILE}.png`,
      `${SB}/storage/v1/object/public/app-media/meme-duel/${USER}/../../x.png`,
      "https://i.imgflip.com/1bij.jpg",
      "blob:http://localhost:3000/abc",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "",
    ]) {
      expect(isAllowedMediaUrl(url, sb), url).toBe(false);
    }
  });

  it("accepts /api/demo-media/<id> in demo mode, relative or on our origin", () => {
    expect(isAllowedMediaUrl(`/api/demo-media/${DEMO_ID}`, demo)).toBe(true);
    expect(isAllowedMediaUrl(`${ORIGIN}/api/demo-media/${DEMO_ID}`, demo)).toBe(true);
    expect(demoMediaId(`${ORIGIN}/api/demo-media/${DEMO_ID}`, ORIGIN)).toBe(DEMO_ID);
  });

  it("rejects demo URLs on other origins, with bad ids, or when Supabase is configured", () => {
    expect(isAllowedMediaUrl(`https://evil.test/api/demo-media/${DEMO_ID}`, demo)).toBe(false);
    expect(isAllowedMediaUrl(`/api/demo-media/${DEMO_ID.toUpperCase()}`, demo)).toBe(false);
    expect(isAllowedMediaUrl(`/api/demo-media/${DEMO_ID}/x`, demo)).toBe(false);
    expect(isAllowedMediaUrl(`/api/demo-media/../${DEMO_ID}`, demo)).toBe(false);
    expect(isAllowedMediaUrl(`${ORIGIN}/api/demo-media/${DEMO_ID}?a=1`, demo)).toBe(false);
    expect(isAllowedMediaUrl(`/api/demo-media/${DEMO_ID}`, sb)).toBe(false);
    expect(isAllowedMediaUrl(`/api/demo-media/${DEMO_ID}`, { ...sb, demo: true })).toBe(true);
  });
});

describe("shareLinkFor", () => {
  it("turns an uploaded image into our card page, so X shows the picture", () => {
    expect(shareableImageKey(APP_MEDIA, SB)).toBe(`meme-duel/${USER}/${FILE}.png`);
    expect(shareLinkFor(APP_MEDIA, ORIGIN, SB)).toBe(`${ORIGIN}/s/meme-duel/${USER}/${FILE}.png`);
  });
  it("leaves every other link alone", () => {
    expect(shareLinkFor(undefined, ORIGIN, SB)).toBeUndefined();
    expect(shareLinkFor(`${ORIGIN}/apps/meme-duel`, ORIGIN, SB)).toBe(`${ORIGIN}/apps/meme-duel`);
    expect(shareLinkFor(APP_MEDIA.replace(".png", ".mp4"), ORIGIN, SB)).toBe(APP_MEDIA.replace(".png", ".mp4"));
    expect(shareLinkFor(`https://evil.example/storage/v1/object/public/app-media/meme-duel/${USER}/${FILE}.png`, ORIGIN, SB)).toContain("evil.example");
    expect(shareLinkFor(APP_MEDIA, ORIGIN, "")).toBe(APP_MEDIA);
  });
});

describe("meme image allow list", () => {
  it("takes app-media images (not audio/video) and passes demo uploads through", () => {
    expect(isAllowedMemeSource(APP_MEDIA, SB)).toBe(true);
    expect(isAllowedMemeSource(APP_MEDIA.replace(".png", ".mp4"), SB)).toBe(false);
    expect(isAllowedMemeSource(`${SB}/storage/v1/object/public/meme-drops/${USER}/a.png`, SB)).toBe(true);
    expect(memeImageUrl(`/api/demo-media/${DEMO_ID}`)).toBe(`/api/demo-media/${DEMO_ID}`);
    expect(memeImageUrl(APP_MEDIA)).toBe(`/api/meme-image?src=${encodeURIComponent(APP_MEDIA)}`);
  });
});

describe("displayProblem", () => {
  const opts = { supabaseUrl: SB, origin: ORIGIN };
  const up = APP_MEDIA;

  it("accepts uploaded media for every kind", () => {
    expect(displayProblem({ kind: "video", url: up, alt: "clip", poster: up }, opts)).toBeNull();
    expect(displayProblem({ kind: "audio", url: up, alt: "song", cover: up }, opts)).toBeNull();
    expect(displayProblem({ kind: "gallery", items: [{ url: up, alt: "a" }, { url: up, alt: "b" }] }, opts)).toBeNull();
    expect(displayProblem({ kind: "image", url: up, alt: "" }, opts)).toBeNull();
    expect(displayProblem({ kind: "text", body: "hi" }, opts)).toBeNull();
  });

  it("keeps the v1 image rule (any https) but rejects other media URLs", () => {
    expect(displayProblem({ kind: "image", url: "https://example.com/a.png", alt: "" }, opts)).toBeNull();
    expect(displayProblem({ kind: "image", url: "http://example.com/a.png", alt: "" }, opts)).toMatch(/https/);
    expect(displayProblem({ kind: "video", url: "https://example.com/a.mp4", alt: "x" }, opts)).toMatch(/media\.upload/);
    expect(displayProblem({ kind: "video", url: "blob:http://localhost:3000/x", alt: "x" }, opts)).toMatch(/media\.upload/);
    expect(displayProblem({ kind: "video", url: up, alt: "x", poster: "https://example.com/p.png" }, opts)).toMatch(/poster/);
    expect(displayProblem({ kind: "audio", url: up, alt: "x", cover: "data:image/png;base64,AA" }, opts)).toMatch(/cover/);
    expect(displayProblem({ kind: "audio", url: up, alt: " " }, opts)).toMatch(/alt/);
  });

  it("checks gallery size and items", () => {
    expect(displayProblem({ kind: "gallery", items: [{ url: up, alt: "a" }] }, opts)).toMatch(/2–6/);
    const seven = Array.from({ length: 7 }, (_, i) => ({ url: up, alt: String(i) }));
    expect(displayProblem({ kind: "gallery", items: seven }, opts)).toMatch(/2–6/);
    expect(displayProblem({ kind: "gallery", items: [{ url: up, alt: "a" }, { url: "https://x.test/b.png", alt: "b" }] }, opts)).toMatch(
      /Gallery/,
    );
  });
});

describe("media limits", () => {
  it("knows the kinds and per-kind sizes", () => {
    expect(mediaKindOf("video/webm; codecs=vp9")).toBe("video");
    expect(mediaKindOf("audio/wav")).toBe("audio");
    expect(mediaKindOf("image/svg+xml")).toBeNull();
    expect(mediaProblem("image/png", 1)).toBeNull();
    expect(mediaProblem("image/png", LIMITS.media.image.maxBytes + 1)).toMatch(/8 MB/);
    expect(mediaProblem("video/mp4", LIMITS.media.video.maxBytes)).toBeNull();
    expect(mediaProblem("text/html", 10)).toMatch(/not text\/html/);
    expect(mediaProblem("image/png", 0)).toMatch(/empty/);
  });

  it("enforces the rolling daily quota", () => {
    expect(mediaQuotaProblem([], 1)).toBeNull();
    expect(mediaQuotaProblem(Array.from({ length: 60 }, () => ({ bytes: 1 })), 1)).toMatch(/60 files/);
    expect(mediaQuotaProblem([{ bytes: 199 * 1024 * 1024 }], 2 * 1024 * 1024)).toMatch(/200 MB/);
  });

  it("sniffs magic bytes", () => {
    const pad = (bytes: number[]) => new Uint8Array([...bytes, ...new Array(16).fill(0)]);
    const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
    expect(bytesMatchMime(pad([0x89, ...text("PNG")]), "image/png")).toBe(true);
    expect(bytesMatchMime(pad([0xff, 0xd8, 0xff]), "image/jpeg")).toBe(true);
    expect(bytesMatchMime(pad([0, 0, 0, 0x20, ...text("ftypisom")]), "video/mp4")).toBe(true);
    expect(bytesMatchMime(pad([...text("RIFF"), 0, 0, 0, 0, ...text("WAVE")]), "audio/wav")).toBe(true);
    expect(bytesMatchMime(pad(text("<html><script>")), "image/png")).toBe(false);
    expect(bytesMatchMime(pad([...text("RIFF"), 0, 0, 0, 0, ...text("WAVE")]), "image/webp")).toBe(false);
  });
});

describe("formatStat", () => {
  it("formats per the manifest format", () => {
    expect(formatStat(1234.567)).toBe("1,234.57");
    expect(formatStat(87.5, "percent")).toBe("87.5%");
    expect(formatStat(850, "ms")).toBe("850 ms");
    expect(formatStat(8120, "ms")).toBe("8.12 s");
    expect(formatStat(65_400, "ms")).toBe("1:05.4");
    expect(formatStat(Number.NaN)).toBe("–");
  });
});
