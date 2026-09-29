import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, resetConnection } from "../src/client";
import {
  accessProblem,
  createHostCore,
  mediaKindOf,
  resolveHostHandler,
  validateRequest,
  type HostBridge,
  type HostHandlers,
} from "../src/host";
import { LIMITS, type AchievementDef, type LaunchContext, type MediaRef, type PlayerInfo, type StatDef } from "../src/protocol";
import { cloneMessage, createMemoryTransportPair } from "../src/transport";

const tick = () => new Promise((r) => setTimeout(r, 0));

function seat(id: string, n: number): PlayerInfo {
  return { id, handle: id, name: id, avatarUrl: null, seat: n, isBot: false, submitted: false, score: null, team: null, role: "player" };
}

const STATS: StatDef[] = [
  { key: "best_time", label: "Best time", aggregate: "min", format: "ms" },
  { key: "wins", label: "Wins", aggregate: "sum" },
];
const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_win", name: "First win", description: "Win a match", icon: "🏆", xp: 10 },
  { id: "speedy", name: "Speedy", description: "Under 10 s", icon: "⚡", xp: 20, secret: true },
];

function makeContext(
  options: { purpose?: LaunchContext["purpose"]; role?: "player" | "spectator"; defs?: boolean } = {},
): LaunchContext {
  const spectator = options.role === "spectator";
  return {
    purpose: options.purpose ?? "match",
    app: {
      id: "app-1",
      slug: "demo",
      name: "Demo",
      ...(options.defs === false ? {} : { stats: STATS, achievements: ACHIEVEMENTS }),
    },
    user: { id: "alice", handle: "alice", name: "Alice", avatarUrl: null },
    match: {
      id: "m1",
      mode: "live",
      status: "active",
      scoring: "votes",
      seed: "seed",
      seat: spectator ? -1 : 0,
      settings: {},
      players: spectator ? [seat("bob", 0), seat("cara", 1)] : [seat("alice", 0), seat("bob", 1)],
      minPlayers: 2,
      maxPlayers: 2,
      teams: 0,
      role: spectator ? "spectator" : "player",
      state: null,
      stateVersion: 0,
      turn: null,
      turnDeadline: null,
      round: 0,
    },
    host: { name: "Test host", version: "0", origin: "memory://host" },
    locale: "en",
  };
}

async function setup(context = makeContext(), handlers: HostHandlers = {}) {
  const pair = createMemoryTransportPair();
  const onRequestError = vi.fn();
  const host: HostBridge = createHostCore(pair.host, { context: () => context, handlers, onRequestError });
  const client = await connect({ transport: pair.app, timeoutMs: 1000 });
  return { host, client, context, onRequestError };
}

/** A Blob as seen from another realm (an iframe): not `instanceof Blob`, but shaped like one. */
const foreignBlob = (type: string, size: number) => ({ type, size, arrayBuffer: async () => new ArrayBuffer(0) });

const png = (bytes = 16) => new Blob([new Uint8Array(bytes)], { type: "image/png" });

afterEach(() => resetConnection());

describe("transport", () => {
  it("passes Blobs through the memory transport and keeps JSON semantics for the rest", () => {
    const file = png();
    const message = { a: 1, skip: undefined, nested: [{ file }], date: new Date(0) };
    const copy = cloneMessage(message);
    expect(copy.nested[0]!.file).toBe(file);
    expect(copy).not.toBe(message);
    expect("skip" in copy).toBe(false);
    expect(copy.date).toBe("1970-01-01T00:00:00.000Z");
    expect(cloneMessage({ x: [1, 2] })).toEqual({ x: [1, 2] });
  });
});

describe("media.upload", () => {
  it("round-trips a Blob to the host handler (alias uploadMedia) and returns the MediaRef", async () => {
    const ref: MediaRef = { url: "https://cdn.test/a.png", kind: "image", mime: "image/png", bytes: 16, width: 4, height: 4 };
    const uploadMedia = vi.fn((params: { file: Blob; alt?: string }) => {
      expect(params.file.size).toBe(16);
      expect(params.file.type).toBe("image/png");
      return ref;
    });
    const { client } = await setup(makeContext(), { uploadMedia });
    const file = png();
    await expect(client.media.upload(file, { alt: "A tiny square" })).resolves.toEqual(ref);
    expect(uploadMedia).toHaveBeenCalledTimes(1);
    const params = uploadMedia.mock.calls[0]![0];
    expect(params.file).toBe(file);
    expect(params.alt).toBe("A tiny square");
    const bytes = new Uint8Array(await params.file.arrayBuffer());
    expect(bytes.length).toBe(16);
  });

  it("checks type, size and alt on the client", async () => {
    const handler = vi.fn(() => ({ url: "/x", kind: "image" as const, mime: "image/png", bytes: 1 }));
    const { client } = await setup(makeContext(), { "media.upload": handler });
    const reject = (file: unknown, alt?: string) =>
      expect(client.media.upload(file as Blob, alt === undefined ? {} : { alt })).rejects.toMatchObject({ code: "invalid_params" });
    await reject("not a file");
    await reject(new Blob(["x"], { type: "application/pdf" }));
    await reject(new Blob([], { type: "image/png" }));
    await reject(foreignBlob("image/png", LIMITS.media.image.maxBytes + 1));
    await reject(foreignBlob("video/mp4", LIMITS.media.video.maxBytes + 1));
    await reject(png(), "x".repeat(1001));
    expect(handler).not.toHaveBeenCalled();
    // Recorder mime types carry codecs; the limit is per kind.
    await expect(client.media.upload(new Blob(["x"], { type: "video/webm;codecs=vp9,opus" }))).resolves.toBeTruthy();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("maps mime types to kinds", async () => {
    const { client } = await setup();
    expect(client.media.kindOf("image/jpeg")).toBe("image");
    expect(client.media.kindOf("audio/webm;codecs=opus")).toBe("audio");
    expect(client.media.kindOf(" VIDEO/MP4 ")).toBe("video");
    expect(client.media.kindOf("video/x-matroska")).toBeNull();
    expect(mediaKindOf("")).toBeNull();
  });

  it("validates uploads on the host, accepting Blobs from another realm", () => {
    expect(validateRequest("media.upload", { file: foreignBlob("image/webp", 1000) })).toBeNull();
    expect(validateRequest("media.upload", { file: foreignBlob("audio/wav", 1000), alt: "beep" })).toBeNull();
    expect(validateRequest("media.upload", { file: { type: "image/png", size: 3 } })).toMatch(/Blob/);
    expect(validateRequest("media.upload", {})).toMatch(/Blob/);
    expect(validateRequest("media.upload", { file: foreignBlob("text/html", 10) })).toMatch(/unsupported/);
    expect(validateRequest("media.upload", { file: foreignBlob("audio/mpeg", LIMITS.media.audio.maxBytes + 1) })).toMatch(/10 MB/);
    expect(validateRequest("media.upload", { file: foreignBlob("image/gif", 0) })).toMatch(/empty/);
    expect(validateRequest("media.upload", { file: foreignBlob("image/gif", 5), alt: 3 })).toMatch(/alt/);
  });

  it("uses a long timeout for uploads", async () => {
    vi.useFakeTimers();
    try {
      const { client } = await setup(makeContext(), { "media.upload": () => new Promise(() => {}) });
      const upload = client.media.upload(png());
      let settled = false;
      upload.catch(() => (settled = true));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(110_000);
      await expect(upload).rejects.toMatchObject({ code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("entries with media", () => {
  it("accepts video, audio and gallery displays", async () => {
    const submit = vi.fn(() => ({ state: "waiting" as const, result: null }));
    const { client } = await setup(makeContext(), { "match.submit": submit });
    await client.submit({ display: { kind: "video", url: "https://cdn.test/v.webm", alt: "My clip", poster: "/api/demo-media/p" } });
    await client.submit({ display: { kind: "audio", url: "/api/demo-media/a", alt: "My song", cover: "https://cdn.test/c.png" } });
    await client.submit({
      display: { kind: "gallery", items: [{ url: "blob:https://app.test/1", alt: "one" }, { url: "http://cdn.test/2.png", alt: "two" }] },
    });
    expect(submit).toHaveBeenCalledTimes(3);
  });

  it("rejects bad media displays on the client and on the host", async () => {
    const { client } = await setup(makeContext(), { "match.submit": () => ({ state: "waiting", result: null }) });
    const bad = [
      { kind: "video", url: "https://cdn.test/v.mp4" }, // alt required
      { kind: "video", url: "https://cdn.test/v.mp4", alt: "  " },
      { kind: "video", url: "javascript:alert(1)", alt: "x" },
      { kind: "video", url: "//evil.test/v.mp4", alt: "x" },
      { kind: "video", url: "https://cdn.test/v.mp4", alt: "x", poster: "data:image/png;base64,AAAA" },
      { kind: "audio", url: "ftp://cdn.test/a.mp3", alt: "x" },
      { kind: "audio", url: "/a.mp3", alt: "x", cover: 5 },
      { kind: "gallery", items: [{ url: "/1.png", alt: "one" }] },
      { kind: "gallery", items: Array.from({ length: LIMITS.galleryItems.max + 1 }, (_, i) => ({ url: `/${i}.png`, alt: "x" })) },
      { kind: "gallery", items: [{ url: "/1.png", alt: "one" }, { url: "/2.png" }] },
      { kind: "gallery", items: "nope" },
      { kind: "hologram" },
    ];
    for (const display of bad) {
      expect(() => client.submit({ display: display as never }), JSON.stringify(display)).toThrow(/submit:/);
      expect(validateRequest("match.submit", { display }), JSON.stringify(display)).not.toBeNull();
    }
    // Raw requests that skip the SDK checks are refused by the host.
    await expect(
      client.request("match.submit", { display: { kind: "gallery", items: [] } }),
    ).rejects.toMatchObject({ code: "invalid_params" });
  });
});

describe("storage", () => {
  it("round-trips get/set/delete/list with scopes (aliases storageDelete / storageList)", async () => {
    const calls: unknown[] = [];
    const handlers: HostHandlers = {
      "storage.get": (p) => (calls.push(["get", p]), p.scope === "app" ? { daily: 7 } : null),
      "storage.set": (p) => (calls.push(["set", p]), null),
      storageDelete: (p) => (calls.push(["delete", p]), null),
      storageList: (p) => (calls.push(["list", p]), ["a", "b"]),
    };
    const { client } = await setup(makeContext(), handlers);
    await expect(client.storage.get("puzzle", { scope: "app" })).resolves.toEqual({ daily: 7 });
    await expect(client.storage.get("progress")).resolves.toBeNull();
    await client.storage.set("progress", { level: 3 });
    await client.storage.delete("progress");
    await expect(client.storage.list({ prefix: "p", scope: "app" })).resolves.toEqual(["a", "b"]);
    await client.storage.list();
    expect(calls).toEqual([
      ["get", { key: "puzzle", scope: "app" }],
      ["get", { key: "progress" }],
      ["set", { key: "progress", value: { level: 3 } }],
      ["delete", { key: "progress" }],
      ["list", { prefix: "p", scope: "app" }],
      ["list", {}],
    ]);
  });

  it("checks keys, scopes and the 64 KB value limit", async () => {
    const set = vi.fn(() => null);
    const { client } = await setup(makeContext(), { "storage.set": set, "storage.get": () => null });
    await expect(client.storage.set("big", "x".repeat(LIMITS.storageValueBytes))).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.storage.set("", 1)).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.storage.set("k", { d: new Date() } as never)).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.storage.get("k", { scope: "world" as never })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.storage.list({ prefix: "x".repeat(65) })).rejects.toMatchObject({ code: "invalid_params" });
    // 20 KB was over the v1 limit and is fine now.
    await expect(client.storage.set("mid", "x".repeat(20_000))).resolves.toBeNull();
    expect(set).toHaveBeenCalledTimes(1);

    expect(validateRequest("storage.get", { key: "k", scope: "app" })).toBeNull();
    expect(validateRequest("storage.get", { key: "k", scope: "global" })).toMatch(/scope/);
    expect(validateRequest("storage.set", { key: "k", value: 1, scope: "app" })).toMatch(/server/);
    expect(validateRequest("storage.set", { key: "k" })).toMatch(/required/);
    expect(validateRequest("storage.set", { key: "k", value: "x".repeat(LIMITS.storageValueBytes) })).toMatch(/large/);
    expect(validateRequest("storage.delete", { key: "" })).toMatch(/key/);
    expect(validateRequest("storage.delete", { key: "k", scope: "app" })).toMatch(/server/);
    expect(validateRequest("storage.list", {})).toBeNull();
    expect(validateRequest("storage.list", { prefix: 3 })).toMatch(/prefix/);
  });
});

describe("stats and achievements", () => {
  it("reports stats (alias reportStats) and exposes the defs", async () => {
    const reportStats = vi.fn((p: { values: { [k: string]: number } }) => ({ ...p.values }));
    const { client } = await setup(makeContext(), { reportStats });
    expect(client.stats.defs).toEqual(STATS);
    await expect(client.stats.report({ best_time: 9_000, wins: 1 })).resolves.toEqual({ best_time: 9_000, wins: 1 });
    expect(reportStats).toHaveBeenCalledWith({ values: { best_time: 9_000, wins: 1 } });
    for (const values of [{}, { wins: Number.NaN }, { wins: Infinity }, { wins: "1" }, { unknown_stat: 1 }, [1]]) {
      await expect(client.stats.report(values as never), JSON.stringify(values)).rejects.toMatchObject({ code: "invalid_params" });
    }
    expect(reportStats).toHaveBeenCalledTimes(1);
  });

  it("host refuses undeclared stats and achievements when the context carries defs", async () => {
    const reportStats = vi.fn(() => ({}));
    const unlockAchievement = vi.fn(() => ({ unlocked: true }));
    const { client } = await setup(makeContext(), { reportStats, unlockAchievement });
    await expect(client.request("stats.report", { values: { nope: 1 } })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.request("achievements.unlock", { id: "nope" })).rejects.toMatchObject({ code: "invalid_params" });
    expect(reportStats).not.toHaveBeenCalled();
    expect(unlockAchievement).not.toHaveBeenCalled();
  });

  it("without defs in the context, only the shape is checked", async () => {
    const { client } = await setup(makeContext({ defs: false }), { reportStats: () => ({ anything: 2 }), unlockAchievement: () => ({ unlocked: true }) });
    expect(client.stats.defs).toEqual([]);
    expect(client.achievements.defs).toEqual([]);
    await expect(client.stats.report({ anything: 2 })).resolves.toEqual({ anything: 2 });
    await expect(client.achievements.unlock("whatever")).resolves.toEqual({ unlocked: true });
    await expect(client.achievements.unlock("Bad Id")).rejects.toMatchObject({ code: "invalid_params" });
    expect(validateRequest("stats.report", { values: { "Bad-Key": 1 } })).toMatch(/key/);
    expect(validateRequest("stats.report", { values: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`s${i}`, i])) })).toMatch(/8/);
    expect(validateRequest("stats.report", { values: { a: null } })).toMatch(/finite/);
    expect(validateRequest("achievements.unlock", { id: 3 })).toMatch(/id/);
  });

  it("unlocks achievements, tracks them and fires onAchievement (alias unlockAchievement, emitAchievement)", async () => {
    let bridge: HostBridge | null = null;
    const owned = new Set<string>();
    const unlockAchievement = vi.fn(({ id }: { id: string }) => {
      if (owned.has(id)) return { unlocked: false };
      owned.add(id);
      bridge!.emitAchievement(id, "alice");
      return { unlocked: true };
    });
    const { client, host } = await setup(makeContext(), { unlockAchievement });
    bridge = host;
    const events: Array<[string, string, string | undefined]> = [];
    client.onAchievement((u, def) => events.push([u.id, u.userId, def?.name]));
    const changes: number[] = [];
    client.achievements.onChange((set) => changes.push(set.size));

    expect(client.achievements.defs).toEqual(ACHIEVEMENTS);
    const before = client.achievements.unlocked;
    await expect(client.achievements.unlock("first_win")).resolves.toEqual({ unlocked: true });
    await expect(client.achievements.unlock("first_win")).resolves.toEqual({ unlocked: false });
    await expect(client.achievements.unlock("not_declared")).rejects.toMatchObject({ code: "invalid_params" });
    host.emitAchievement("speedy", "bob"); // someone else's unlock
    await tick();
    expect(events).toEqual([
      ["first_win", "alice", "First win"],
      ["speedy", "bob", "Speedy"],
    ]);
    expect([...client.achievements.unlocked]).toEqual(["first_win"]);
    expect(client.achievements.unlocked).not.toBe(before); // new snapshot per change
    expect(changes).toEqual([1]);
    expect(unlockAchievement).toHaveBeenCalledTimes(2);
  });

  it("resolves the new friendly aliases", () => {
    const fn = () => null;
    expect(resolveHostHandler({ uploadMedia: fn as never }, "media.upload")).toBe(fn);
    expect(resolveHostHandler({ reportStats: fn as never }, "stats.report")).toBe(fn);
    expect(resolveHostHandler({ unlockAchievement: fn as never }, "achievements.unlock")).toBe(fn);
    expect(resolveHostHandler({ storageDelete: fn as never }, "storage.delete")).toBe(fn);
    expect(resolveHostHandler({ storageList: fn as never }, "storage.list")).toBe(fn);
  });
});

describe("access rules", () => {
  const blocked = [
    ["media.upload", { file: png() }],
    ["stats.report", { values: { wins: 1 } }],
    ["achievements.unlock", { id: "first_win" }],
    ["storage.set", { key: "k", value: 1 }],
    ["storage.delete", { key: "k" }],
  ] as const;

  it("refuses spectators locally", async () => {
    const { client } = await setup(makeContext({ role: "spectator" }));
    await expect(client.media.upload(png())).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.stats.report({ wins: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.achievements.unlock("first_win")).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.storage.set("k", 1)).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.storage.delete("k")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses spectators on the host, but lets them read storage", async () => {
    const handlers: HostHandlers = {
      "media.upload": vi.fn(),
      "stats.report": vi.fn(),
      "achievements.unlock": vi.fn(),
      "storage.set": vi.fn(),
      "storage.delete": vi.fn(),
      "storage.get": () => "v",
      "storage.list": () => ["k"],
    };
    const { client, onRequestError } = await setup(makeContext({ role: "spectator" }), handlers);
    for (const [method, params] of blocked) {
      await expect(client.request(method, params as never)).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(onRequestError).toHaveBeenCalledTimes(blocked.length);
    await expect(client.storage.get("k", { scope: "app" })).resolves.toBe("v");
    await expect(client.storage.list()).resolves.toEqual(["k"]);
  });

  it("setup purpose allows uploads and storage reads, not stats or achievements", async () => {
    const ref: MediaRef = { url: "/api/demo-media/1", kind: "image", mime: "image/png", bytes: 16 };
    const handlers: HostHandlers = {
      "media.upload": () => ref,
      "storage.get": () => null,
      "storage.list": () => [],
      "stats.report": vi.fn(),
      "achievements.unlock": vi.fn(),
    };
    const { client } = await setup(makeContext({ purpose: "setup" }), handlers);
    await expect(client.media.upload(png())).resolves.toEqual(ref);
    await expect(client.storage.get("k")).resolves.toBeNull();
    await expect(client.storage.list({ scope: "app" })).resolves.toEqual([]);
    await expect(client.stats.report({ wins: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.achievements.unlock("first_win")).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.request("stats.report", { values: { wins: 1 } })).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.request("achievements.unlock", { id: "first_win" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("accessProblem covers the new methods", () => {
    const spectator = { purpose: "match" as const, match: { role: "spectator" as const } };
    for (const [method] of blocked) expect(accessProblem(method, spectator)).toMatch(/spectator/);
    expect(accessProblem("storage.get", spectator)).toBeNull();
    expect(accessProblem("storage.list", spectator)).toBeNull();
    expect(accessProblem("media.upload", { purpose: "setup" })).toBeNull();
    expect(accessProblem("storage.list", { purpose: "setup" })).toBeNull();
    expect(accessProblem("stats.report", { purpose: "setup" })).toMatch(/setting up/);
    expect(accessProblem("achievements.unlock", { purpose: "setup" })).toMatch(/setting up/);
    expect(accessProblem("stats.report", { purpose: "match", match: { role: "player" } })).toBeNull();
  });
});
