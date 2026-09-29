import { fakeLocalStorage, fakeSessionStorage, resetFakeBrowser } from "./fake-browser";
import { LIMITS } from "@xapps/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendError } from "../backend";
import type { AchievementDef, Profile, RegisterAppInput, StatDef } from "../types";
import { DemoBackend } from "./demo-backend";
import { load } from "./store";

let backend: DemoBackend;
const people: Record<string, Profile> = {};

async function as(handle: string): Promise<Profile> {
  const profile = people[handle] ?? (await backend.demo.signInAs({ handle }));
  people[handle] = profile;
  await backend.demo.switchTo(profile.id);
  return profile;
}

const STATS: StatDef[] = [
  { key: "best_score", label: "Best score", aggregate: "max" },
  { key: "best_time", label: "Best time", aggregate: "min", format: "ms" },
  { key: "runs", label: "Runs", aggregate: "sum" },
  { key: "last_rank", label: "Last rank", aggregate: "last" },
];

const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_win", name: "First win", description: "Win a match", icon: "🏆", xp: 25 },
  { id: "hidden", name: "Hidden gem", description: "Find it", icon: "💎", xp: 50, secret: true },
  { id: "free", name: "Free", description: "", icon: "🎈", xp: 0 },
];

function appInput(slug: string, extra: Partial<RegisterAppInput> = {}): RegisterAppInput {
  return {
    slug,
    name: slug,
    tagline: "t",
    description: "d",
    category: "games",
    icon: "🎲",
    accent: ["#000", "#fff"],
    url: "https://example.com",
    modes: ["live", "async", "practice"],
    scoring: "high",
    howTo: [],
    stats: STATS,
    achievements: ACHIEVEMENTS,
    ...extra,
  };
}

async function expectCode(promise: Promise<unknown>, code: BackendError["code"], message?: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BackendError);
  expect((error as BackendError).code).toBe(code);
  if (message) expect((error as BackendError).message).toMatch(message);
}

beforeEach(async () => {
  resetFakeBrowser();
  for (const key of Object.keys(people)) delete people[key];
  backend = new DemoBackend();
  await as("alice");
  await backend.registerApp(appInput("progress"));
});

afterEach(() => {
  backend.dispose();
  vi.unstubAllGlobals();
  fakeLocalStorage.clear();
  fakeSessionStorage.clear();
});

describe("manifest stats & achievements", () => {
  it("persists them on registration", async () => {
    const app = await backend.getApp("progress");
    expect(app?.stats).toEqual(STATS);
    expect(app?.achievements).toEqual(ACHIEVEMENTS);
    expect((await backend.getApp("meme-duel"))?.stats).toEqual([]);
  });

  it("rejects invalid definitions like the database", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ key: `s${i}`, label: `S${i}`, aggregate: "max" as const }));
    await expectCode(backend.registerApp(appInput("a1", { stats: nine })), "invalid", /8 stats/);
    await expectCode(backend.registerApp(appInput("a2", { stats: [{ key: "Bad Key", label: "x", aggregate: "max" }] })), "invalid", /key/);
    await expectCode(
      backend.registerApp(appInput("a3", { stats: [STATS[0]!, { ...STATS[1]!, key: "best_score" }] })),
      "invalid",
      /twice/,
    );
    await expectCode(
      backend.registerApp(appInput("a4", { stats: [{ key: "k", label: "k", aggregate: "avg" as never }] })),
      "invalid",
      /aggregate/,
    );
    const heavy = Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, description: "", icon: "⭐", xp: 100 }));
    await expectCode(backend.registerApp(appInput("a5", { achievements: heavy })), "invalid", /500 XP/);
    await expectCode(
      backend.registerApp(appInput("a6", { achievements: [{ ...ACHIEVEMENTS[0]!, xp: 101 }] })),
      "invalid",
      /0 to 100/,
    );
    await expectCode(
      backend.registerApp(appInput("a7", { achievements: [{ ...ACHIEVEMENTS[0]!, icon: "ab" }] })),
      "invalid",
      /emoji/,
    );
    await expectCode(
      backend.registerApp(appInput("a8", { achievements: [{ ...ACHIEVEMENTS[0]!, xp: 1.5 }] })),
      "invalid",
      /whole number/,
    );
  });
});

describe("storage", () => {
  it("keeps user scope private per player and app", async () => {
    await backend.storageSet("progress", "save", { level: 3 });
    expect(await backend.storageGet("progress", "save")).toEqual({ level: 3 });
    expect(await backend.storageGet("progress", "save", "app")).toBeNull();
    await as("bob");
    expect(await backend.storageGet("progress", "save")).toBeNull();
    await as("alice");
    await backend.storageSet("progress", "save:2", 1);
    await backend.storageSet("progress", "other", 2);
    expect(await backend.storageList("progress")).toEqual(["other", "save", "save:2"]);
    expect(await backend.storageList("progress", "save")).toEqual(["save", "save:2"]);
    await backend.storageDelete("progress", "save");
    expect(await backend.storageGet("progress", "save")).toBeNull();
    expect(await backend.storageList("progress", "save")).toEqual(["save:2"]);
  });

  it("reads the app scope without signing in (only servers write it)", async () => {
    const db = JSON.parse(fakeLocalStorage.getItem("xapps:demo-db:v4")!);
    db.appStorage = { "progress:daily": { puzzle: 7 } };
    fakeLocalStorage.setItem("xapps:demo-db:v4", JSON.stringify(db));
    await backend.signOut();
    expect(await backend.storageGet("progress", "daily", "app")).toEqual({ puzzle: 7 });
    expect(await backend.storageList("progress", undefined, "app")).toEqual(["daily"]);
    await expectCode(backend.storageGet("progress", "daily"), "unauthenticated");
  });

  it("enforces key length, value size and the 200 key limit", async () => {
    await expectCode(backend.storageSet("progress", "", 1), "invalid");
    await expectCode(backend.storageSet("progress", "k".repeat(65), 1), "invalid");
    await expectCode(backend.storageSet("progress", "big", "x".repeat(LIMITS.storageValueBytes)), "invalid", /64 KB/);
    await backend.storageSet("progress", "almost", "x".repeat(LIMITS.storageValueBytes - 10));
    await expectCode(backend.storageGet("progress", "k", "global" as never), "invalid", /scope/);
    await expectCode(backend.storageSet("nope", "k", 1), "not_found");

    const db = JSON.parse(fakeLocalStorage.getItem("xapps:demo-db:v4")!);
    const me = people.alice!.id;
    for (let i = 0; i < 199; i++) db.storage[`progress:${me}:k${i}`] = i;
    fakeLocalStorage.setItem("xapps:demo-db:v4", JSON.stringify(db));
    await expectCode(backend.storageSet("progress", "one-too-many", 1), "conflict", /200 keys/);
    await backend.storageSet("progress", "k1", "overwrite is fine");
  });
});

describe("stats", () => {
  it("applies each aggregate and returns the new values", async () => {
    expect(await backend.reportStats("progress", { best_score: 10, best_time: 9000, runs: 1, last_rank: 3 })).toEqual({
      best_score: 10,
      best_time: 9000,
      runs: 1,
      last_rank: 3,
    });
    expect(await backend.reportStats("progress", { best_score: 7, best_time: 8000, runs: 2, last_rank: 5 })).toEqual({
      best_score: 10,
      best_time: 8000,
      runs: 3,
      last_rank: 5,
    });
    const stats = await backend.userStats(people.alice!.id);
    expect(stats.map((s) => [s.key, s.value])).toEqual([
      ["best_score", 10],
      ["best_time", 8000],
      ["runs", 3],
      ["last_rank", 5],
    ]);
  });

  it("refuses undeclared keys, bad numbers and server-authoritative apps", async () => {
    await expectCode(backend.reportStats("progress", { nope: 1 }), "invalid", /Unknown stat/);
    await expectCode(backend.reportStats("progress", { runs: Number.NaN }), "invalid", /finite/);
    await expectCode(backend.reportStats("progress", { runs: 2e15 }), "invalid", /range/);
    await expectCode(backend.reportStats("progress", {}), "invalid");
    // Nothing half-applied.
    await expectCode(backend.reportStats("progress", { runs: 1, zzz: 1 }), "invalid");
    expect(await backend.userStats(people.alice!.id)).toEqual([]);

    await backend.rotateAppSecret("progress");
    await backend.setAppAuthority("progress", "server");
    await expectCode(backend.reportStats("progress", { runs: 1 }), "forbidden", /from its server/);
    await expectCode(backend.unlockAchievement("progress", "first_win"), "forbidden", /from its server/);
  });

  it("orders leaderboards by direction, ties share a rank, earlier holders first", async () => {
    await backend.reportStats("progress", { best_score: 50, best_time: 5000 });
    await as("bob");
    await backend.reportStats("progress", { best_score: 80, best_time: 7000 });
    await as("carol");
    await backend.reportStats("progress", { best_score: 50, best_time: 5000 });
    await as("dave");
    await backend.reportStats("progress", { best_score: 10 });

    const high = await backend.statLeaderboard("progress", "best_score");
    expect(high.map((r) => [r.rank, r.profile.handle, r.value])).toEqual([
      [1, "bob", 80],
      [2, "alice", 50],
      [2, "carol", 50],
      [4, "dave", 10],
    ]);
    const low = await backend.statLeaderboard("progress", "best_time");
    expect(low.map((r) => [r.rank, r.profile.handle, r.value])).toEqual([
      [1, "alice", 5000],
      [1, "carol", 5000],
      [3, "bob", 7000],
    ]);
    await expectCode(backend.statLeaderboard("progress", "nope"), "invalid");
  });
});

describe("achievements", () => {
  it("unlocks once and adds XP once", async () => {
    const before = (await backend.getViewer())!.xp;
    expect(await backend.unlockAchievement("progress", "first_win")).toEqual({ unlocked: true });
    expect(await backend.unlockAchievement("progress", "first_win")).toEqual({ unlocked: false });
    expect((await backend.getViewer())!.xp).toBe(before + 25);
    expect(await backend.unlockAchievement("progress", "free")).toEqual({ unlocked: true });
    expect((await backend.getViewer())!.xp).toBe(before + 25);
    await expectCode(backend.unlockAchievement("progress", "nope"), "invalid", /Unknown achievement/);
  });

  it("lists unlocks newest first, including secret ones, per player", async () => {
    await backend.unlockAchievement("progress", "first_win");
    await new Promise((r) => setTimeout(r, 5));
    await backend.unlockAchievement("progress", "hidden");
    const mine = await backend.userAchievements(people.alice!.id);
    expect(mine.map((a) => a.achievementId)).toEqual(["hidden", "first_win"]);
    expect(mine.every((a) => a.appSlug === "progress")).toBe(true);
    await as("bob");
    expect(await backend.userAchievements(people.bob!.id)).toEqual([]);
    expect((await backend.userAchievements(people.alice!.id)).length).toBe(2);
  });
});

describe("media uploads", () => {
  const png = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])], { type: "image/png" });

  function stubUploads() {
    let n = 0;
    const fetch = vi.fn(async () => {
      n += 1;
      const id = n.toString(16).padStart(32, "0");
      return Response.json({ id, url: `/api/demo-media/${id}` }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("posts to /api/demo-media and returns a MediaRef", async () => {
    const fetch = stubUploads();
    const ref = await backend.uploadMedia("progress", png());
    expect(ref).toMatchObject({ url: `/api/demo-media/${"1".padStart(32, "0")}`, kind: "image", mime: "image/png", bytes: 12 });
    expect(fetch).toHaveBeenCalledWith("/api/demo-media", expect.objectContaining({ method: "POST" }));
    expect(load().mediaUploads).toHaveLength(1);
  });

  it("validates type and size before uploading", async () => {
    const fetch = stubUploads();
    await expectCode(backend.uploadMedia("progress", new Blob(["<svg/>"], { type: "image/svg+xml" })), "invalid");
    const huge = { type: "image/png", size: LIMITS.media.image.maxBytes + 1, arrayBuffer: async () => new ArrayBuffer(0) } as Blob;
    await expectCode(backend.uploadMedia("progress", huge), "invalid", /8 MB/);
    await expectCode(backend.uploadMedia("progress", "nope" as unknown as Blob), "invalid");
    await expectCode(backend.uploadMedia("missing-app", png()), "not_found");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("enforces the per-app daily quota", async () => {
    stubUploads();
    const db = JSON.parse(fakeLocalStorage.getItem("xapps:demo-db:v4")!);
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const row = { appSlug: "progress", userId: people.alice!.id, url: "/x", bytes: 1, mime: "image/png" };
    db.mediaUploads = [
      ...Array.from({ length: 59 }, () => ({ ...row, createdAt: now })),
      ...Array.from({ length: 10 }, () => ({ ...row, createdAt: old })),
      { ...row, appSlug: "other", createdAt: now },
    ];
    fakeLocalStorage.setItem("xapps:demo-db:v4", JSON.stringify(db));
    await backend.uploadMedia("progress", png());
    await expectCode(backend.uploadMedia("progress", png()), "rate_limited", /60 files/);
    // Old rows are pruned as uploads are recorded.
    expect(load().mediaUploads!.every((u) => Date.parse(u.createdAt) > Date.now() - 86_400_000)).toBe(true);
  });
});

describe("entries with media", () => {
  it("rejects media displays that aren't our uploads", async () => {
    await as("bob");
    await as("alice");
    const match = await backend.startPractice("progress");
    const upload = `/api/demo-media/${"a".repeat(32)}`;
    await expectCode(
      backend.submit(match.id, { score: 1, display: { kind: "video", url: "https://evil.test/v.mp4", alt: "x" } }),
      "invalid",
      /media\.upload/,
    );
    await expectCode(
      backend.submit(match.id, { score: 1, display: { kind: "gallery", items: [{ url: upload, alt: "a" }] } }),
      "invalid",
      /2–6/,
    );
    const done = await backend.submit(match.id, { score: 1, display: { kind: "audio", url: upload, alt: "my song" } });
    expect(done.players.find((p) => p.userId === people.alice!.id)?.submission?.display).toEqual({ kind: "audio", url: upload, alt: "my song" });
  });
});
