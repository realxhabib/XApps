import { fakeSessionStorage, resetFakeBrowser } from "./fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendError } from "../backend";
import { manifestOf } from "../shipping";
import type { AppLogEntry, Profile, RegisterAppInput, VersionManifest } from "../types";
import { computeAnalytics } from "./analytics";
import { DemoBackend } from "./demo-backend";
import { PRACTICE_BOTS } from "./seed";
import { MATCH_V2_DEFAULTS, load, mutate, newPlayerRow, type DemoDb, type MatchRow } from "./store";

let backend: DemoBackend;
const people: Record<string, Profile> = {};

async function as(handle: string): Promise<Profile> {
  const profile = people[handle] ?? (await backend.demo.signInAs({ handle }));
  people[handle] = profile;
  await backend.demo.switchTo(profile.id);
  return profile;
}

function appInput(slug: string, extra: Partial<RegisterAppInput> = {}): RegisterAppInput {
  return {
    slug,
    name: slug,
    tagline: "t",
    description: "d",
    category: "games",
    icon: "🎲",
    accent: ["#000000", "#ffffff"],
    url: "https://example.com/app",
    modes: ["live", "async", "practice"],
    scoring: "high",
    howTo: [],
    ...extra,
  };
}

async function expectCode(promise: Promise<unknown>, code: BackendError["code"]): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BackendError);
  expect((error as BackendError).code).toBe(code);
}

/** alice registers `slug`; returns the manifest of its live version. */
async function registered(slug = "gizmo", extra: Partial<RegisterAppInput> = {}): Promise<VersionManifest> {
  await as("alice");
  const app = await backend.registerApp(appInput(slug, extra));
  return manifestOf(app);
}

/** alice creates, submits and (as a demo admin) approves `label`. */
async function approvedVersion(slug: string, label: string, manifest: VersionManifest, url = `https://example.com/${label}`) {
  await as("alice");
  const draft = await backend.createAppVersion(slug, { version: label, url, manifest, notes: "notes" });
  await backend.submitAppVersion(draft.id);
  await backend.demo.setAdmin(true);
  const approved = await backend.reviewAppVersion(draft.id, "approve", "");
  await backend.demo.setAdmin(false);
  return approved;
}

beforeEach(() => {
  resetFakeBrowser();
  for (const key of Object.keys(people)) delete people[key];
  fakeSessionStorage.setItem("xapps:demo-invited", "1");
  backend = new DemoBackend();
});

afterEach(() => {
  backend.dispose();
  vi.useRealTimers();
});

describe("demo backend: versions", () => {
  it("registering creates 1.0.0, which demo mode approves and publishes", async () => {
    await registered();
    const [v1] = await backend.listAppVersions("gizmo");
    expect(v1).toMatchObject({ version: "1.0.0", status: "published", url: "https://example.com/app", reviewNotes: "Auto-approved in demo mode" });
    expect(v1!.manifest).toMatchObject({ name: "gizmo", players: { min: 2, max: 2 }, scoring: "high" });
    expect(v1!.publishedAt).not.toBeNull();
  });

  it("runs the lifecycle: draft → review → approved → published (the old one retires)", async () => {
    const manifest = await registered();
    const draft = await backend.createAppVersion("gizmo", {
      version: "1.1.0",
      url: "https://example.com/next",
      manifest: { ...manifest, name: "Gizmo 2", players: { min: 2, max: 4 } },
    });
    expect(draft).toMatchObject({ status: "draft", submittedAt: null, notes: "" });
    await expectCode(backend.createAppVersion("gizmo", { version: "1.1.0", url: "https://example.com", manifest }), "conflict");
    await expectCode(backend.createAppVersion("gizmo", { version: "1.1", url: "https://example.com", manifest }), "invalid");
    await expectCode(backend.createAppVersion("gizmo", { version: "1.2.0", url: "http://example.com", manifest }), "invalid");
    await expectCode(backend.createAppVersion("gizmo", { version: "1.2.0", url: "https://example.com", manifest: { ...manifest, players: { min: 3, max: 2 } } }), "invalid");

    const edited = await backend.updateAppVersion(draft.id, { notes: "Bigger tables" });
    expect(edited.notes).toBe("Bigger tables");
    const inReview = await backend.submitAppVersion(draft.id);
    expect(inReview.status).toBe("in_review");
    expect(inReview.submittedAt).not.toBeNull();
    await expectCode(backend.updateAppVersion(draft.id, { notes: "late" }), "conflict");
    await expectCode(backend.publishAppVersion(draft.id), "conflict");

    expect((await backend.withdrawAppVersion(draft.id)).status).toBe("draft");
    await backend.submitAppVersion(draft.id);

    await backend.demo.setAdmin(true);
    const approved = await backend.reviewAppVersion(draft.id, "approve", "Looks good");
    expect(approved).toMatchObject({ status: "approved", reviewNotes: "Looks good" });
    // Approving a later version doesn't publish it: the owner does.
    expect((await backend.getApp("gizmo"))!.name).toBe("gizmo");

    const published = await backend.publishAppVersion(draft.id);
    expect(published.status).toBe("published");
    const app = (await backend.getApp("gizmo"))!;
    expect(app).toMatchObject({ name: "Gizmo 2", url: "https://example.com/next", players: { min: 2, max: 4 }, status: "published" });
    const versions = await backend.listAppVersions("gizmo");
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      ["1.1.0", "published"],
      ["1.0.0", "retired"],
    ]);
  });

  it("lets rejected versions be edited and resubmitted", async () => {
    const manifest = await registered();
    const draft = await backend.createAppVersion("gizmo", { version: "2.0.0", url: "https://example.com/2", manifest });
    await backend.submitAppVersion(draft.id);
    await backend.demo.setAdmin(true);
    await expectCode(backend.reviewAppVersion(draft.id, "reject", "  "), "invalid");
    const rejected = await backend.reviewAppVersion(draft.id, "reject", "The start button is hidden on phones");
    expect(rejected).toMatchObject({ status: "rejected", reviewNotes: "The start button is hidden on phones" });
    await expectCode(backend.reviewAppVersion(draft.id, "approve", ""), "conflict");
    expect((await backend.updateAppVersion(draft.id, { url: "https://example.com/2b" })).url).toBe("https://example.com/2b");
    expect((await backend.submitAppVersion(draft.id)).status).toBe("in_review");
  });

  it("keeps versions to the owner", async () => {
    const manifest = await registered();
    await as("bob");
    await expectCode(backend.listAppVersions("gizmo"), "forbidden");
    await expectCode(backend.createAppVersion("gizmo", { version: "9.0.0", url: "https://evil.example", manifest }), "forbidden");
    await expectCode(backend.listAppVersions("quick-draw"), "forbidden");
    await expectCode(backend.listAppVersions("nope"), "not_found");
  });

  it("gives apps from before versions a published 1.0.0", async () => {
    await registered();
    mutate((db) => {
      db.versions = {};
      db.publishedVersions = {};
    });
    const versions = await backend.listAppVersions("gizmo");
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: "1.0.0", status: "published" });
  });
});

describe("demo backend: review queue", () => {
  it("is for admins only, oldest submission first, with the published version to diff against", async () => {
    const manifest = await registered();
    await registered("other");
    const a = await backend.createAppVersion("gizmo", { version: "1.1.0", url: "https://example.com/a", manifest });
    await backend.submitAppVersion(a.id);
    const b = await backend.createAppVersion("other", { version: "1.0.1", url: "https://example.com/b", manifest: { ...manifest, name: "other" } });
    await backend.submitAppVersion(b.id);

    await expectCode(backend.listReviewQueue(), "forbidden");
    await expectCode(backend.reviewAppVersion(a.id, "approve", ""), "forbidden");

    const admin = await backend.demo.setAdmin(true);
    expect(admin.isAdmin).toBe(true);
    expect((await backend.getViewer())?.isAdmin).toBe(true);
    const queue = await backend.listReviewQueue();
    expect(queue.map((item) => item.version.id)).toEqual([a.id, b.id]);
    expect(queue[0]).toMatchObject({ app: { slug: "gizmo" }, developer: { handle: "alice" }, published: { version: "1.0.0", status: "published" } });

    await backend.reviewAppVersion(a.id, "approve", "");
    expect((await backend.listReviewQueue()).map((item) => item.version.id)).toEqual([b.id]);
    await backend.demo.setAdmin(false);
    expect((await backend.getViewer())?.isAdmin).toBeUndefined();
  });

  it("approving the first version of an unlisted app publishes it", async () => {
    await registered();
    // Pretend the app was registered on a server that doesn't auto-approve: 1.0.0 is waiting.
    mutate((db) => {
      db.apps.gizmo!.status = "pending";
      db.publishedVersions = {};
      for (const v of Object.values(db.versions ?? {})) Object.assign(v, { status: "in_review", reviewedAt: null, publishedAt: null });
    });
    const [first] = await backend.listAppVersions("gizmo");
    await backend.demo.setAdmin(true);
    // Turned down: the app is marked rejected until a version is resubmitted.
    await backend.reviewAppVersion(first!.id, "reject", "Crashes on start");
    expect((await backend.getApp("gizmo"))!.status).toBe("rejected");
    await backend.submitAppVersion(first!.id);
    expect((await backend.getApp("gizmo"))!.status).toBe("pending");
    expect((await backend.reviewAppVersion(first!.id, "approve", "Welcome")).status).toBe("published");
    expect((await backend.getApp("gizmo"))!.status).toBe("published");
  });

  it("lets admins read any app's versions, analytics and logs", async () => {
    await registered();
    await as("bob");
    await backend.demo.setAdmin(true);
    expect((await backend.listAppVersions("gizmo")).length).toBe(1);
    expect(await backend.listAppLogs("gizmo")).toEqual([]);
    expect((await backend.appAnalytics("gizmo", 7)).days).toBe(7);
    await expectCode(backend.createAppVersion("gizmo", { version: "9.9.9", url: "https://x.example", manifest: (await backend.listAppVersions("gizmo"))[0]!.manifest }), "forbidden");
  });
});

describe("demo backend: developer notices", () => {
  it("tells the developer about review decisions and marks them read", async () => {
    const manifest = await registered();
    const a = await backend.createAppVersion("gizmo", { version: "1.1.0", url: "", manifest: undefined as never });
    // Missing url/manifest copy the app's.
    expect(a).toMatchObject({ url: "https://example.com/app", manifest: { name: manifest.name } });
    await backend.submitAppVersion(a.id);
    const b = await backend.createAppVersion("gizmo", { version: "1.2.0", url: "https://example.com/b", manifest });
    await backend.submitAppVersion(b.id);
    await as("bob");
    await backend.demo.setAdmin(true);
    await backend.reviewAppVersion(a.id, "approve", "Nice");
    await backend.reviewAppVersion(b.id, "reject", "Broken on phones");
    expect(await backend.listMyNotices()).toEqual([]);

    await as("alice");
    const notices = await backend.listMyNotices();
    expect(notices.map((n) => [n.kind, n.version, n.readAt])).toEqual([
      ["version_rejected", "1.2.0", null],
      ["version_approved", "1.1.0", null],
    ]);
    expect(notices[0]!.message).toBe("gizmo 1.2.0 was not approved: Broken on phones");
    expect(notices[1]!.message).toBe("gizmo 1.1.0 was approved. Publish it when you're ready. Reviewer notes: Nice");
    expect(await backend.markNoticesRead([notices[1]!.id])).toBe(1);
    expect(await backend.markNoticesRead()).toBe(1);
    expect(await backend.markNoticesRead()).toBe(0);
    expect((await backend.listMyNotices()).every((n) => n.readAt)).toBe(true);
  });
});

describe("demo backend: testers & test builds", () => {
  it("manages testers by handle", async () => {
    await as("bob");
    await registered();
    expect(await backend.listAppTesters("gizmo")).toEqual([]);
    const testers = await backend.addAppTester("gizmo", "@Bob");
    expect(testers.map((p) => p.handle)).toEqual(["bob"]);
    expect(await backend.addAppTester("gizmo", "bob")).toHaveLength(1);
    await expectCode(backend.addAppTester("gizmo", "nobody_here"), "not_found");
    await expectCode(backend.addAppTester("gizmo", "alice"), "invalid");
    expect(await backend.removeAppTester("gizmo", people.bob!.id)).toEqual([]);
    await as("bob");
    await expectCode(backend.addAppTester("gizmo", "bob"), "forbidden");
  });

  it("test builds load the version url, are for owner/testers only and never touch XP, records or the play count", async () => {
    await as("bob");
    await as("carol");
    const manifest = await registered();
    const version = await approvedVersion("gizmo", "1.1.0", manifest, "https://example.com/app?build=1.1.0");
    await backend.addAppTester("gizmo", "bob");

    // Owner practice on the test build.
    const practice = await backend.startPractice("gizmo", undefined, version.id);
    expect(practice).toMatchObject({ versionId: version.id, versionUrl: "https://example.com/app?build=1.1.0", versionLabel: "1.1.0", mode: "practice" });

    // The live version is just the app: play that instead.
    const [, live] = await backend.listAppVersions("gizmo");
    await expectCode(backend.startPractice("gizmo", undefined, live!.id), "invalid");
    expect((await backend.startPractice("gizmo")).versionId).toBeNull();

    // Non-testers can't start or be invited to one.
    await as("carol");
    await expectCode(backend.startPractice("gizmo", undefined, version.id), "forbidden");
    await as("alice");
    await expectCode(backend.createChallenge({ appSlug: "gizmo", mode: "live", opponentHandle: "carol", versionId: version.id }), "forbidden");

    const before = { ...(await backend.getViewer())! };
    const match = await backend.createChallenge({ appSlug: "gizmo", mode: "live", opponentHandle: "bob", versionId: version.id });
    expect(match.versionId).toBe(version.id);
    await as("carol");
    expect(await backend.getMatch(match.id)).toBeNull();
    await expectCode(backend.spectate(match.id), "not_found");
    await as("bob");
    await backend.joinMatch(match.id);
    await backend.submit(match.id, { score: 3 });
    await as("alice");
    const done = await backend.submit(match.id, { score: 5 });
    expect(done.status).toBe("completed");
    expect(done.winnerId).toBe(people.alice!.id);
    expect(done.players.every((p) => p.xpDelta === 0)).toBe(true);
    const after = (await backend.getViewer())!;
    expect(after).toMatchObject({ xp: before.xp, wins: before.wins, losses: before.losses });
    const db = load();
    expect(db.playCounts.gizmo ?? 0).toBe(0);
    expect(db.appStats[`gizmo:${people.alice!.id}`]).toBeUndefined();
    expect((await backend.leaderboard("gizmo")).length).toBe(0);
    expect((await backend.listRecentActivity()).some((m) => m.id === match.id)).toBe(false);
    expect((await backend.listUserMatches(people.alice!.id)).some((m) => m.id === match.id)).toBe(false);

    // Like play_app, any version but the live one can be played as a test build (retired ones too).
    mutate((db) => void (db.versions![version.id]!.status = "retired"));
    expect((await backend.startPractice("gizmo", undefined, version.id)).versionId).toBe(version.id);
  });

  it("plays by the version's manifest and keeps quick-match lobbies per build", async () => {
    const manifest = await registered("table", { players: { min: 2, max: 2 } });
    const version = await approvedVersion("table", "2.0.0", { ...manifest, players: { min: 2, max: 4 } });
    const practice = await backend.startPractice("table", 4, version.id);
    expect(practice.maxPlayers).toBe(4);
    await expectCode(backend.startPractice("table", 4), "invalid");

    const lobby = await backend.quickMatch("table", version.id);
    expect(lobby.versionId).toBe(version.id);
    const regular = await backend.quickMatch("table");
    expect(regular.id).not.toBe(lobby.id);
    expect(regular.versionId).toBeNull();
    expect(PRACTICE_BOTS.length).toBeGreaterThan(3);
  });
});

describe("demo backend: logs", () => {
  it("stores entries for players and owners, newest first, filtered by minimum level", async () => {
    await registered();
    const match = await backend.startPractice("gizmo");
    await backend.logAppEvent({ appSlug: "gizmo", matchId: match.id, level: "debug", message: "hello", source: "app" });
    await backend.logAppEvent({ appSlug: "gizmo", matchId: match.id, level: "error", message: "x".repeat(600), data: { a: 1 }, source: "app" });
    await backend.logAppEvent({ appSlug: "gizmo", matchId: null, level: "warn", message: "state.set refused", source: "host" });
    const all = await backend.listAppLogs("gizmo");
    expect(all.map((l) => l.level)).toEqual(["warn", "error", "debug"]);
    expect(all[1]).toMatchObject({ matchId: match.id, data: { a: 1 }, source: "app", userId: people.alice!.id });
    expect(all[1]!.message).toHaveLength(500);
    expect(all[1]!.versionId).not.toBeNull();
    expect((await backend.listAppLogs("gizmo", { level: "warn" })).map((l) => l.level)).toEqual(["warn", "error"]);
    expect((await backend.listAppLogs("gizmo", { matchId: match.id })).length).toBe(2);
    expect((await backend.listAppLogs("gizmo", { limit: 1 })).length).toBe(1);

    await expectCode(backend.logAppEvent({ appSlug: "gizmo", matchId: null, level: "loud" as never, message: "x", source: "app" }), "invalid");
    await expectCode(backend.logAppEvent({ appSlug: "gizmo", matchId: null, level: "info", message: "   ", source: "app" }), "invalid");
    await expectCode(
      backend.logAppEvent({ appSlug: "gizmo", matchId: null, level: "info", message: "x", data: { blob: "y".repeat(5000) }, source: "app" }),
      "invalid",
    );

    await as("bob");
    await expectCode(backend.listAppLogs("gizmo"), "forbidden");
    await expectCode(backend.logAppEvent({ appSlug: "gizmo", matchId: null, level: "info", message: "hi", source: "app" }), "forbidden");
    await expectCode(backend.logAppEvent({ appSlug: "gizmo", matchId: match.id, level: "info", message: "hi", source: "app" }), "forbidden");
  });

  it("drops entries past 60 per minute silently", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    await registered();
    for (let i = 0; i < 65; i++) {
      await backend.logAppEvent({ appSlug: "gizmo", matchId: null, level: "info", message: `m${i}`, source: "app" });
    }
    expect((await backend.listAppLogs("gizmo", { limit: 500 })).length).toBe(60);
    vi.setSystemTime(new Date("2026-09-29T12:01:01Z"));
    await backend.logAppEvent({ appSlug: "gizmo", matchId: null, level: "info", message: "later", source: "app" });
    expect((await backend.listAppLogs("gizmo", { limit: 1 }))[0]!.message).toBe("later");
  });

  it("keeps 2,000 entries per app for 7 days", async () => {
    await registered();
    const now = Date.now();
    const entry = (i: number, ageMs: number, appSlug = "gizmo"): AppLogEntry => ({
      id: `seed-${appSlug}-${i}`,
      appSlug,
      versionId: null,
      matchId: null,
      userId: null,
      level: "info",
      message: `seed ${i}`,
      data: null,
      source: "app",
      createdAt: new Date(now - ageMs).toISOString(),
    });
    mutate((db) => {
      db.logs = [
        entry(0, 8 * 86_400_000),
        ...Array.from({ length: 2050 }, (_, i) => entry(i + 1, (2051 - i) * 1000)),
        ...Array.from({ length: 5 }, (_, i) => entry(i, 1000, "other")),
      ];
    });
    await backend.logAppEvent({ appSlug: "gizmo", matchId: null, level: "info", message: "newest", source: "app" });
    const logs = load().logs!;
    const gizmo = logs.filter((l) => l.appSlug === "gizmo");
    expect(gizmo).toHaveLength(2000);
    expect(gizmo.some((l) => l.id === "seed-gizmo-0")).toBe(false);
    expect(gizmo.some((l) => l.id === "seed-gizmo-1")).toBe(false);
    expect(gizmo.at(-1)!.message).toBe("newest");
    expect(logs.filter((l) => l.appSlug === "other")).toHaveLength(5);
  });
});

describe("demo analytics", () => {
  const NOW = Date.parse("2026-09-29T18:00:00Z");
  const day = (d: number, hour = 12) => new Date(Date.parse(`2026-09-${String(d).padStart(2, "0")}T00:00:00Z`) + hour * 3_600_000).toISOString();
  const person = (id: string): Profile => ({
    id,
    handle: id,
    name: id,
    avatarUrl: null,
    bio: "",
    xp: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    bestStreak: 0,
    createdAt: day(1),
  });

  function match(id: string, created: string, extra: Partial<MatchRow> & { seats: [string, "win" | "loss" | null][] }): MatchRow {
    const { seats, ...rest } = extra;
    return {
      ...MATCH_V2_DEFAULTS,
      id,
      appSlug: "fx",
      mode: "live",
      status: "completed",
      scoring: "high",
      seed: "s",
      createdBy: seats[0]![0],
      createdAt: created,
      updatedAt: created,
      startedAt: created,
      endedAt: new Date(Date.parse(created) + 120_000).toISOString(),
      winnerId: null,
      isOpen: false,
      settings: {},
      votes: {},
      votesNeeded: 5,
      votingEndsAt: null,
      simulatedVotes: false,
      players: seats.map(([userId, result], seat) => newPlayerRow(userId, seat, { result, isBot: userId.startsWith("bot-") })),
      ...rest,
    };
  }

  function fixture(): DemoDb {
    const db = load();
    const out: DemoDb = { ...structuredClone(db), matches: {}, versions: { "v-2": { id: "v-2", appSlug: "fx", version: "2.0.0" } as never } };
    for (const id of ["ann", "ben", "cat", "dan"]) out.profiles[id] = person(id);
    const rows = [
      // ann's first match was long before the window.
      match("m0", day(1), { seats: [["ann", "win"], ["ben", "loss"]] }),
      match("m1", day(26), { seats: [["ann", "win"], ["cat", "loss"]], startedAt: day(26), endedAt: new Date(Date.parse(day(26)) + 60_000).toISOString() }),
      match("m2", day(27), { seats: [["cat", "win"], ["ann", "loss"]], maxPlayers: 4, minPlayers: 2 }),
      match("m3", day(27), { seats: [["ann", null], ["bot-xapps", null]], mode: "practice", status: "cancelled", endedAt: null }),
      match("m4", day(29, 9), { seats: [["ben", "win"], ["ann", "loss"]], publishedVersionId: "v-2", startedAt: day(29, 9), endedAt: new Date(Date.parse(day(29, 9)) + 300_000).toISOString() }),
      // Test builds never count.
      match("m5", day(29, 10), { seats: [["ann", "win"], ["dan", "loss"]], versionId: "v-3" }),
    ];
    for (const row of rows) out.matches[row.id] = row;
    return out;
  }

  it("computes the series, totals, splits, retention and top players", () => {
    const stats = computeAnalytics(fixture(), "fx", 7, NOW);
    expect(stats.days).toBe(7);
    expect(stats.series.map((d) => d.date)).toEqual(["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"]);
    const byDate = Object.fromEntries(stats.series.map((d) => [d.date, d]));
    expect(byDate["2026-09-26"]).toEqual({ date: "2026-09-26", matchesCreated: 1, matchesCompleted: 1, matchesAbandoned: 0, players: 2, newPlayers: 1 });
    expect(byDate["2026-09-27"]).toEqual({ date: "2026-09-27", matchesCreated: 2, matchesCompleted: 1, matchesAbandoned: 1, players: 2, newPlayers: 0 });
    expect(byDate["2026-09-29"]).toMatchObject({ matchesCreated: 1, matchesCompleted: 1, players: 2, newPlayers: 0 });
    expect(byDate["2026-09-24"]).toMatchObject({ matchesCreated: 0, players: 0 });
    expect(stats.totals).toEqual({ matches: 4, completed: 3, players: 3, newPlayers: 1 });
    expect(stats.completionRate).toBe(0.75);
    // Durations: 60 s, 120 s, 300 s.
    expect(stats.medianDurationSec).toBe(120);
    expect(stats.modes).toEqual([
      { mode: "live", matches: 3 },
      { mode: "practice", matches: 1 },
    ]);
    expect(stats.tableSizes).toEqual([
      { players: 2, matches: 3 },
      { players: 4, matches: 1 },
    ]);
    // cat (new on the 26th) played again on the 27th; nobody new is 7 days old yet.
    expect(stats.retention).toEqual({ d1: 1, d7: null });
    expect(stats.topPlayers.map((p) => [p.profile.handle, p.matches, p.wins])).toEqual([
      ["ann", 4, 1],
      ["cat", 2, 1],
      ["ben", 1, 1],
    ]);
    expect(stats.versions).toEqual([
      { versionId: null, version: null, matches: 3 },
      { versionId: "v-2", version: "2.0.0", matches: 1 },
    ]);
  });

  it("is owner/admin only through the backend", async () => {
    await registered();
    await expectCode(backend.appAnalytics("gizmo", 0), "invalid");
    await expectCode(backend.appAnalytics("gizmo", 366), "invalid");
    const stats = await backend.appAnalytics("gizmo", 14);
    expect(stats.series).toHaveLength(14);
    expect(stats.totals.matches).toBe(0);
    expect(stats.retention).toEqual({ d1: null, d7: null });
    await as("bob");
    await expectCode(backend.appAnalytics("gizmo"), "forbidden");
    await backend.demo.setAdmin(true);
    expect((await backend.appAnalytics("gizmo")).days).toBe(30);
  });
});
