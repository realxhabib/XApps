import { describe, expect, it } from "vitest";
import { appImageKeyError, appImageSrc, STORAGE_KEY_PATTERN } from "./app-images";

const UID = "11111111-2222-4333-8444-555555555555";
const KEY = `${UID}/${"a".repeat(32)}.webp`;
const DATA = "data:image/webp;base64,UklGRg==";

describe("app image keys", () => {
  it("accepts storage keys everywhere and data URLs only in demo mode", () => {
    expect(appImageKeyError(null)).toBeNull();
    expect(appImageKeyError(undefined)).toBeNull();
    expect(appImageKeyError(KEY)).toBeNull();
    expect(appImageKeyError(`${UID}/${"b".repeat(32)}.jpg`)).toBeNull();
    expect(appImageKeyError(DATA)).not.toBeNull();
    expect(appImageKeyError(DATA, { demo: true })).toBeNull();
  });

  it("rejects URLs, other files and oversized data", () => {
    for (const bad of [
      "https://evil.example.com/x.png",
      `${UID}/evil.svg`,
      `${UID}/${"a".repeat(32)}.gif`,
      `../${UID}/${"a".repeat(32)}.webp`,
      "data:image/svg+xml;base64,PHN2Zz4=",
      `data:image/png;base64,${"A".repeat(400_001)}`,
      42,
    ]) {
      expect(appImageKeyError(bad, { demo: true }), String(bad).slice(0, 40)).not.toBeNull();
    }
  });

  it("mirrors the SQL key check", () => {
    expect(STORAGE_KEY_PATTERN.source).toContain("(webp|jpg|png)");
  });

  it("resolves keys to the public bucket or the data URL itself", () => {
    expect(appImageSrc(KEY, "https://abc.supabase.co")).toBe(`https://abc.supabase.co/storage/v1/object/public/app-images/${KEY}`);
    expect(appImageSrc(DATA, "")).toBe(DATA);
    expect(appImageSrc(KEY, "")).toBeNull();
    expect(appImageSrc("https://evil.example.com/x.png", "https://abc.supabase.co")).toBeNull();
    expect(appImageSrc(null)).toBeNull();
  });
});
