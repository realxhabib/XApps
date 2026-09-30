import { describe, expect, it } from "vitest";
import { BackendError, type Backend } from "@/platform/backend";
import type { Profile, StatStanding } from "@/platform/types";
import { LOGGED_REFUSALS, createLogThrottle, readStatStanding, toSdkStanding } from "./use-app-bridge";

describe("host refusal logging", () => {
  it("logs invalid params, forbidden and rate limits only", () => {
    expect([...LOGGED_REFUSALS].sort()).toEqual(["forbidden", "invalid_params", "rate_limited"]);
    expect(LOGGED_REFUSALS.has("conflict")).toBe(false);
  });

  it("throttles host logs per minute", () => {
    let now = 0;
    const take = createLogThrottle(3, () => now);
    expect([take(), take(), take(), take()]).toEqual([true, true, true, false]);
    now = 59_999;
    expect(take()).toBe(false);
    now = 60_000;
    expect(take()).toBe(true);
  });
});

describe("stats.leaderboard", () => {
  const ada: Profile = {
    id: "u1",
    handle: "ada",
    name: "Ada",
    avatarUrl: "https://pbs.example/ada.jpg",
    bio: "hi",
    xp: 5,
    wins: 1,
    losses: 0,
    draws: 0,
    streak: 1,
    bestStreak: 1,
    createdAt: "2026-01-01T00:00:00Z",
    isBot: false,
  };
  const standing: StatStanding = { key: "best", top: [{ rank: 1, profile: ada, value: 98.5 }], me: { rank: 14, value: 71 }, total: 2380 };

  it("maps profiles to the SDK's player shape", () => {
    expect(toSdkStanding(standing)).toEqual({
      key: "best",
      top: [{ rank: 1, player: { id: "u1", handle: "ada", name: "Ada", avatarUrl: "https://pbs.example/ada.jpg" }, value: 98.5 }],
      me: { rank: 14, value: 71 },
      total: 2380,
    });
  });

  it("reads the backend, and gives test builds an empty board for stats the live app lacks", async () => {
    const calls: unknown[] = [];
    const ok = { statStanding: async (...args: unknown[]) => (calls.push(args), standing) } as unknown as Backend;
    await expect(readStatStanding(ok, "circle", { key: "best", limit: 5 })).resolves.toMatchObject({ me: { rank: 14 } });
    expect(calls).toEqual([["circle", "best", 5]]);

    const unknown = {
      statStanding: async () => {
        throw new BackendError("Unknown stat best", "invalid");
      },
    } as unknown as Backend;
    await expect(readStatStanding(unknown, "circle", { key: "best" }, true)).resolves.toEqual({ key: "best", top: [], me: null, total: 0 });
    await expect(readStatStanding(unknown, "circle", { key: "best" })).rejects.toMatchObject({ code: "invalid_params" });
  });
});
