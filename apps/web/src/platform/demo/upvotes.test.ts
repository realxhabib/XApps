import { fakeSessionStorage, resetFakeBrowser } from "./fake-browser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendError } from "../backend";
import { OFFICIAL_APPS } from "../catalog";
import { UPVOTES_PER_MINUTE } from "../upvotes";
import type { Profile, RegisterAppInput } from "../types";
import { DemoBackend } from "./demo-backend";
import { load, mutate } from "./store";
import { seededUpvotes } from "./upvotes";

let backend: DemoBackend;
const people: Record<string, Profile> = {};

async function as(handle: string): Promise<Profile> {
  const profile = people[handle] ?? (await backend.demo.signInAs({ handle }));
  people[handle] = profile;
  await backend.demo.switchTo(profile.id);
  return profile;
}

const input: RegisterAppInput = {
  slug: "up-app",
  name: "Up App",
  tagline: "Upvote me",
  description: "",
  category: "games",
  icon: "🔼",
  accent: ["#000000", "#ffffff"],
  url: "https://up.example.com/",
  modes: ["live", "practice"],
  scoring: "high",
  howTo: [],
};

async function expectError(promise: Promise<unknown>, code: BackendError["code"], message?: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BackendError);
  expect((error as BackendError).code).toBe(code);
  if (message) expect((error as BackendError).message).toMatch(message);
}

const upvotes = async (slug: string) => (await backend.getApp(slug))!.upvotes;

beforeEach(() => {
  resetFakeBrowser();
  for (const key of Object.keys(people)) delete people[key];
  fakeSessionStorage.setItem("xapps:demo-invited", "1");
  backend = new DemoBackend();
});

afterEach(() => {
  backend.dispose();
});

describe("demo backend: upvotes", () => {
  it("seeds plausible counts for official apps (some from personas), none for new apps", async () => {
    const apps = await backend.listApps();
    for (const official of OFFICIAL_APPS) {
      expect(apps.find((a) => a.slug === official.slug)!.upvotes).toBeGreaterThan(0);
    }
    const db = load();
    expect(OFFICIAL_APPS.some((a) => seededUpvotes(db, a.slug)!.userIds.length > 0)).toBe(true);
    // Deterministic per slug.
    expect(seededUpvotes(db, OFFICIAL_APPS[0]!.slug)).toEqual(seededUpvotes(load(), OFFICIAL_APPS[0]!.slug));
    expect(new Set(apps.map((a) => a.upvotes)).size).toBeGreaterThan(1);
    await as("alice");
    expect((await backend.registerApp(input)).upvotes).toBe(0);
  });

  it("toggles the viewer's upvote, idempotently, across list and detail", async () => {
    const slug = OFFICIAL_APPS[0]!.slug;
    const start = (await upvotes(slug))!;
    await expectError(backend.setUpvote(slug, true), "unauthenticated");
    await as("bob");
    expect(await backend.setUpvote(slug, true)).toEqual({ upvotes: start + 1, upvoted: true });
    expect(await backend.setUpvote(slug, true)).toEqual({ upvotes: start + 1, upvoted: true });
    expect((await backend.listApps()).find((a) => a.slug === slug)).toMatchObject({ upvotes: start + 1, upvoted: true });
    expect(await backend.getApp(slug)).toMatchObject({ upvotes: start + 1, upvoted: true });
    // Someone else sees the count, not bob's upvote.
    await as("carol");
    expect(await backend.getApp(slug)).toMatchObject({ upvotes: start + 1, upvoted: false });
    await as("bob");
    expect(await backend.setUpvote(slug, false)).toEqual({ upvotes: start, upvoted: false });
    expect(await backend.setUpvote(slug, false)).toEqual({ upvotes: start, upvoted: false });
    await backend.signOut();
    expect(await backend.getApp(slug)).toMatchObject({ upvotes: start, upvoted: false });
  });

  it("personas who upvoted see it as theirs, and can take it back", async () => {
    const db = load();
    const official = OFFICIAL_APPS.find((a) => seededUpvotes(db, a.slug)!.userIds.length > 0)!;
    const persona = seededUpvotes(db, official.slug)!.userIds[0]!;
    await backend.demo.switchTo(persona);
    const before = (await backend.getApp(official.slug))!;
    expect(before.upvoted).toBe(true);
    expect(await backend.setUpvote(official.slug, false)).toEqual({ upvotes: before.upvotes! - 1, upvoted: false });
  });

  it("refuses self-upvotes, unpublished apps and unknown apps", async () => {
    await as("alice");
    await backend.registerApp(input);
    await expectError(backend.setUpvote("up-app", true), "forbidden", /your own app/);
    await as("bob");
    expect(await backend.setUpvote("up-app", true)).toEqual({ upvotes: 1, upvoted: true });
    mutate((db) => {
      db.apps["up-app"]!.status = "pending";
    });
    await as("carol");
    await expectError(backend.setUpvote("up-app", true), "not_found");
    // Taking an upvote back still works once the app is hidden.
    await as("bob");
    expect(await backend.setUpvote("up-app", false)).toEqual({ upvotes: 0, upvoted: false });
    await expectError(backend.setUpvote("up-app", true), "not_found");
    await expectError(backend.setUpvote("nope", true), "not_found");
  });

  it("rate limits", async () => {
    const slug = OFFICIAL_APPS[0]!.slug;
    await as("bob");
    for (let i = 0; i < UPVOTES_PER_MINUTE; i++) await backend.setUpvote(slug, i % 2 === 0);
    await expectError(backend.setUpvote(slug, true), "rate_limited");
  });
});
