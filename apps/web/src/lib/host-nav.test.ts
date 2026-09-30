import { describe, expect, it } from "vitest";
import { isHostHref } from "./host-nav";

describe("isHostHref", () => {
  it("matches the full-screen app hosts", () => {
    expect(isHostHref("/play/m-abc123")).toBe(true);
    expect(isHostHref("/play/m-abc123?x=1")).toBe(true);
    expect(isHostHref("/apps/perfect-circle/open")).toBe(true);
    expect(isHostHref("/apps/perfect-circle/open?version=v1")).toBe(true);
    expect(isHostHref("https://xapps.gg/play/m-1", "https://xapps.gg")).toBe(true);
  });
  it("leaves every other page to the router", () => {
    expect(isHostHref("/apps/perfect-circle")).toBe(false);
    expect(isHostHref("/apps")).toBe(false);
    expect(isHostHref("/play")).toBe(false);
    expect(isHostHref("/developers/apps/x/open-issues")).toBe(false);
    expect(isHostHref("https://evil.example/play/m-1", "https://xapps.gg")).toBe(false);
    expect(isHostHref("")).toBe(false);
  });
});
