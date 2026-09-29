import { fakeLocalStorage, fakeSessionStorage, resetFakeBrowser } from "./fake-browser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendError } from "../backend";
import type { Profile, RegisterAppInput } from "../types";
import { DemoBackend } from "./demo-backend";
import { DEMO_WEBHOOK_ERROR, sha256Hex, webhookUrlError } from "./server-settings";
import { DB_KEY, load } from "./store";

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
    accent: ["#000", "#fff"],
    url: "https://example.com",
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

/** Everything the demo "server" has persisted. */
const rawDb = () => fakeLocalStorage.getItem(DB_KEY) ?? "";

beforeEach(async () => {
  resetFakeBrowser();
  for (const key of Object.keys(people)) delete people[key];
  fakeSessionStorage.setItem("xapps:demo-invited", "1");
  backend = new DemoBackend();
  await as("alice");
  await backend.registerApp(appInput("referee"));
});

afterEach(() => backend.dispose());

describe("demo backend: app server settings", () => {
  it("has no server API, and starts with nothing configured", async () => {
    expect(backend.serverApi).toBe(false);
    expect(await backend.getAppServerConfig("referee")).toEqual({
      secretPrefix: null,
      hasSecret: false,
      webhookUrl: null,
      hasWebhook: false,
      authority: "client",
    });
    expect((await backend.getApp("referee"))?.authority).toBe("client");
  });

  it("creates app secrets in the xas_ format and stores only a hash and prefix", async () => {
    const secret = await backend.rotateAppSecret("referee");
    expect(secret).toMatch(/^xas_[0-9a-f]{48}$/);
    const config = await backend.getAppServerConfig("referee");
    expect(config.hasSecret).toBe(true);
    expect(config.secretPrefix).toBe(secret.slice(0, 8));
    expect(rawDb()).not.toContain(secret);
    expect(rawDb()).not.toContain(secret.slice(8));
    expect(load().credentials?.referee?.secretHash).toBe(await sha256Hex(secret));
  });

  it("rotation replaces the secret: the old hash is gone", async () => {
    const first = await backend.rotateAppSecret("referee");
    const second = await backend.rotateAppSecret("referee");
    expect(second).not.toBe(first);
    const creds = load().credentials?.referee;
    expect(creds?.secretHash).toBe(await sha256Hex(second));
    expect(rawDb()).not.toContain(await sha256Hex(first));
    expect(creds?.rotatedAt).not.toBeNull();
    expect((await backend.getAppServerConfig("referee")).secretPrefix).toBe(second.slice(0, 8));
  });

  it("sets a webhook with a whsec_ signing secret shown once, and clears it", async () => {
    const signing = await backend.setAppWebhook("referee", "  https://api.example.com/xapps  ");
    expect(signing).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(rawDb()).not.toContain(signing!);
    let config = await backend.getAppServerConfig("referee");
    expect(config).toMatchObject({ webhookUrl: "https://api.example.com/xapps", hasWebhook: true });

    // Same URL: nothing new to show.
    expect(await backend.setAppWebhook("referee", "https://api.example.com/xapps")).toBeNull();
    // A new URL gets a new signing secret.
    const next = await backend.setAppWebhook("referee", "https://api.example.com/v2");
    expect(next).toMatch(/^whsec_/);
    expect(next).not.toBe(signing);

    const rotated = await backend.rotateWebhookSecret("referee");
    expect(rotated).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(load().credentials?.referee?.webhookSecretHash).toBe(await sha256Hex(rotated));

    expect(await backend.setAppWebhook("referee", null)).toBeNull();
    config = await backend.getAppServerConfig("referee");
    expect(config).toMatchObject({ webhookUrl: null, hasWebhook: false });
    expect(load().credentials?.referee?.webhookSecretHash).toBeNull();
  });

  it("only accepts https webhook URLs", async () => {
    await expectCode(backend.setAppWebhook("referee", "http://api.example.com/hook"), "invalid");
    await expectCode(backend.setAppWebhook("referee", "not a url"), "invalid");
    await expectCode(backend.setAppWebhook("referee", "https://user:pw@example.com/hook"), "invalid");
    await expectCode(backend.rotateWebhookSecret("referee"), "invalid");
    await expectCode(backend.setAppWebhook("referee", "https://localhost:3000/hook"), "invalid");
    await expectCode(backend.setAppWebhook("referee", "https://192.168.1.4/hook"), "invalid");
    expect(webhookUrlError("https://example.com/hook")).toBeNull();
    expect(webhookUrlError("https://api.example.com:8443/x?y=1")).toBeNull();
  });

  it("server authority needs a secret", async () => {
    await expectCode(backend.setAppAuthority("referee", "server"), "invalid");
    await backend.rotateAppSecret("referee");
    await backend.setAppAuthority("referee", "server");
    expect((await backend.getAppServerConfig("referee")).authority).toBe("server");
    expect((await backend.getApp("referee"))?.authority).toBe("server");
    await backend.setAppAuthority("referee", "client");
    expect((await backend.getApp("referee"))?.authority).toBe("client");
  });

  it("crowd-judged apps can't be server-authoritative", async () => {
    await backend.registerApp(appInput("crowd", { scoring: "votes" }));
    await backend.rotateAppSecret("crowd");
    await expectCode(backend.setAppAuthority("crowd", "server"), "invalid");
    await expectCode(backend.setAppAuthority("referee", "boss" as "server"), "invalid");
  });

  it("records test pings (and match events) as deliveries that were never sent", async () => {
    await expectCode(backend.sendTestWebhook("referee"), "invalid");
    await backend.setAppWebhook("referee", "https://api.example.com/xapps");
    await backend.sendTestWebhook("referee");
    const match = await backend.startPractice("referee");
    const deliveries = await backend.listWebhookDeliveries("referee");
    expect(deliveries.map((d) => d.event)).toEqual(expect.arrayContaining(["ping", "match.created", "match.started"]));
    const ping = deliveries.find((d) => d.event === "ping")!;
    expect(ping).toMatchObject({ matchId: null, attempts: 0, deliveredAt: null, lastStatus: null, lastError: DEMO_WEBHOOK_ERROR });
    expect(deliveries.find((d) => d.event === "match.created")?.matchId).toBe(match.id);
    // Newest first.
    const times = deliveries.map((d) => d.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("apps without a webhook record nothing", async () => {
    await backend.startPractice("referee");
    expect(await backend.listWebhookDeliveries("referee")).toEqual([]);
  });

  it("refuses everyone but the app's developer", async () => {
    await backend.rotateAppSecret("referee");
    await as("mallory");
    await expectCode(backend.getAppServerConfig("referee"), "forbidden");
    await expectCode(backend.rotateAppSecret("referee"), "forbidden");
    await expectCode(backend.setAppWebhook("referee", "https://evil.example.com"), "forbidden");
    await expectCode(backend.rotateWebhookSecret("referee"), "forbidden");
    await expectCode(backend.setAppAuthority("referee", "client"), "forbidden");
    await expectCode(backend.listWebhookDeliveries("referee"), "forbidden");
    await expectCode(backend.sendTestWebhook("referee"), "forbidden");
    // Official apps have no developer to manage them here.
    await expectCode(backend.getAppServerConfig("rps-showdown"), "forbidden");
    await expectCode(backend.getAppServerConfig("nope"), "not_found");
    await backend.signOut();
    await expectCode(backend.rotateAppSecret("referee"), "unauthenticated");
  });
});
