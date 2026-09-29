import { describe, expect, it } from "vitest";
import { LOGGED_REFUSALS, createLogThrottle } from "./use-app-bridge";

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
