import { fakeSessionStorage, resetFakeBrowser } from "./fake-browser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendError } from "../backend";
import { manifestOf } from "../shipping";
import type { Profile, RegisterAppInput, VersionManifest } from "../types";
import { DemoBackend } from "./demo-backend";
import { load, mutate } from "./store";

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
    name: "News Desk",
    tagline: "Headlines, fast",
    description: "",
    category: "news",
    icon: "📰",
    accent: ["#000000", "#ffffff"],
    url: "https://news.example.com/",
    modes: ["live", "practice"],
    scoring: "high",
    howTo: [],
    kind: "app",
    ...extra,
  };
}

async function expectError(promise: Promise<unknown>, code: BackendError["code"], message?: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BackendError);
  expect((error as BackendError).code).toBe(code);
  if (message) expect((error as BackendError).message).toMatch(message);
}

/** alice creates, submits and (as a demo admin) approves `label`. */
async function approvedVersion(slug: string, label: string, manifest: VersionManifest) {
  await as("alice");
  const draft = await backend.createAppVersion(slug, { version: label, url: `https://news.example.com/${label}`, manifest, notes: "" });
  await backend.submitAppVersion(draft.id);
  await backend.demo.setAdmin(true);
  const approved = await backend.reviewAppVersion(draft.id, "approve", "");
  await backend.demo.setAdmin(false);
  return approved;
}

const playCount = async (slug: string) => (await backend.getApp(slug))!.playCount;

beforeEach(() => {
  resetFakeBrowser();
  for (const key of Object.keys(people)) delete people[key];
  fakeSessionStorage.setItem("xapps:demo-invited", "1");
  backend = new DemoBackend();
});

afterEach(() => {
  backend.dispose();
});

describe("demo backend: standalone apps", () => {
  it("registers an app whose versions carry the kind", async () => {
    await as("alice");
    const app = await backend.registerApp(appInput("news-desk"));
    expect(app).toMatchObject({ kind: "app", category: "news" });
    const [v1] = await backend.listAppVersions("news-desk");
    expect(v1!.manifest.kind).toBe("app");
    expect(v1!.manifest).toEqual(manifestOf(app));
    // Games stay games; the default is a game.
    const game = await backend.registerApp(appInput("fin-duel", { kind: undefined, category: "finance" }));
    expect(game.kind).toBe("game");
    const [g1] = await backend.listAppVersions("fin-duel");
    expect(g1!.manifest.kind).toBe("game");
    await expectError(backend.registerApp(appInput("bad-kind", { kind: "widget" as never })), "invalid", /Kind/);
    expect((await backend.getApp("quick-draw"))!.kind).toBe("game");
  });

  it("opens apps for anyone, signed in or not, and counts every open", async () => {
    await as("alice");
    await backend.registerApp(appInput("news-desk"));
    expect(await playCount("news-desk")).toBe(0);
    const launch = await backend.openApp("news-desk");
    expect(launch).toMatchObject({ app: { slug: "news-desk", kind: "app", playCount: 1 }, versionId: null });
    await as("bob");
    await backend.openApp("news-desk");
    await backend.signOut();
    expect((await backend.openApp("news-desk")).app.playCount).toBe(3);
    expect(await playCount("news-desk")).toBe(3);
    await expectError(backend.openApp("no-such-app"), "not_found");
  });

  it("refuses unpublished apps to everyone but their developer", async () => {
    await as("alice");
    await backend.registerApp(appInput("news-desk"));
    mutate((db) => void (db.apps["news-desk"]!.status = "pending"));
    await as("bob");
    await expectError(backend.openApp("news-desk"), "not_found");
    await as("alice");
    expect((await backend.openApp("news-desk")).app.slug).toBe("news-desk");
  });

  it("refuses games: they're played in matches", async () => {
    const before = await playCount("quick-draw");
    await expectError(backend.openApp("quick-draw"), "invalid", /is a game: play it in a match/);
    expect(await playCount("quick-draw")).toBe(before);
    await as("alice");
    await backend.registerApp(appInput("fin-duel", { kind: "game" }));
    await expectError(backend.openApp("fin-duel"), "invalid", /^News Desk is a game: play it in a match$/);
  });

  it("apps have no matches: challenges, quick match and practice refuse them", async () => {
    await as("bob");
    await as("alice");
    await backend.registerApp(appInput("news-desk"));
    const message = /^News Desk is an app you open, not a game: there are no matches$/;
    await expectError(backend.createChallenge({ appSlug: "news-desk", mode: "live" }), "invalid", message);
    await expectError(backend.createChallenge({ appSlug: "news-desk", mode: "live", opponentHandle: "bob" }), "invalid", message);
    await expectError(backend.quickMatch("news-desk"), "invalid", message);
    await expectError(backend.startPractice("news-desk"), "invalid", message);
    expect(Object.values(load().matches).some((m) => m.appSlug === "news-desk")).toBe(false);
  });

  it("test builds: owner and testers only, signed in, never counted; a version can switch kind", async () => {
    await as("bob");
    await as("carol");
    await as("alice");
    const app = await backend.registerApp(appInput("news-desk"));
    const [live] = await backend.listAppVersions("news-desk");
    await backend.addAppTester("news-desk", "bob");
    const appBuild = await approvedVersion("news-desk", "1.1.0", { ...manifestOf(app), tagline: "Dark mode" });
    const gameBuild = await approvedVersion("news-desk", "2.0.0", { ...manifestOf(app), kind: "game", category: "trivia" });
    expect(gameBuild.manifest.kind).toBe("game");

    const launch = await backend.openApp("news-desk", appBuild.id);
    expect(launch).toMatchObject({ versionId: appBuild.id, app: { kind: "app", tagline: "Dark mode", url: "https://news.example.com/1.1.0" } });
    expect(await playCount("news-desk")).toBe(0);
    await as("bob");
    expect((await backend.openApp("news-desk", appBuild.id)).versionId).toBe(appBuild.id);
    await as("carol");
    await expectError(backend.openApp("news-desk", appBuild.id), "forbidden");
    await backend.signOut();
    await expectError(backend.openApp("news-desk", appBuild.id), "unauthenticated");

    await as("alice");
    await expectError(backend.openApp("news-desk", live!.id), "invalid", /live/);
    await expectError(backend.openApp("news-desk", "nope"), "not_found");
    // The game build is played, not opened (and the app build can't be played).
    await expectError(backend.openApp("news-desk", gameBuild.id), "invalid", /is a game/);
    expect((await backend.startPractice("news-desk", undefined, gameBuild.id)).versionId).toBe(gameBuild.id);
    await expectError(backend.quickMatch("news-desk", appBuild.id), "invalid", /app you open/);
    expect(await playCount("news-desk")).toBe(0);
  });

  it("publishing copies the kind onto the app", async () => {
    await as("alice");
    const app = await backend.registerApp(appInput("news-desk"));
    const gameBuild = await approvedVersion("news-desk", "2.0.0", { ...manifestOf(app), kind: "game" });
    await backend.publishAppVersion(gameBuild.id);
    expect((await backend.getApp("news-desk"))!.kind).toBe("game");
    expect((await backend.startPractice("news-desk")).mode).toBe("practice");
    await expectError(backend.openApp("news-desk"), "invalid");
    const appBuild = await approvedVersion("news-desk", "3.0.0", { ...manifestOf(app), kind: "app" });
    await backend.publishAppVersion(appBuild.id);
    expect((await backend.getApp("news-desk"))!.kind).toBe("app");
  });

  it("a manifest without kind (from before standalone apps) is a game", async () => {
    await as("alice");
    const app = await backend.registerApp(appInput("news-desk"));
    const legacy: VersionManifest = { ...manifestOf(app) };
    delete legacy.kind;
    const build = await approvedVersion("news-desk", "2.0.0", legacy);
    expect(build.manifest.kind).toBe("game");
  });

  it("viewers of an app log outside a match; games still need one", async () => {
    await as("alice");
    await backend.registerApp(appInput("news-desk"));
    await backend.registerApp(appInput("fin-duel", { kind: "game" }));
    await as("bob");
    await backend.logAppEvent({ appSlug: "news-desk", matchId: null, level: "info", message: "opened", source: "app" });
    await expectError(
      backend.logAppEvent({ appSlug: "fin-duel", matchId: null, level: "info", message: "x", source: "app" }),
      "forbidden",
    );
    expect((load().logs ?? []).filter((l) => l.appSlug === "news-desk")).toHaveLength(1);
  });
});
