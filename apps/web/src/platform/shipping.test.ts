import { describe, expect, it } from "vitest";
import { getOfficialApp } from "./catalog";
import {
  applyVersionToApp,
  cleanManifest,
  compareSemver,
  isTestBuild,
  levelsFrom,
  manifestOf,
  sortVersions,
  testBuildLabel,
  versionLabelError,
  versionManifestError,
  versionUrlError,
} from "./shipping";
import type { AppVersion } from "./types";

describe("shipping rules", () => {
  it("orders semver labels", () => {
    expect(compareSemver("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemver("2.0.0", "2.0.0")).toBe(0);
    const v = (version: string, createdAt = "") => ({ version, createdAt }) as AppVersion;
    expect(sortVersions([v("1.0.0"), v("1.2.0"), v("1.1.0")]).map((x) => x.version)).toEqual(["1.2.0", "1.1.0", "1.0.0"]);
    // Newest created first, like list_app_versions.
    expect(sortVersions([v("2.0.0", "2026-01-01"), v("1.0.1", "2026-02-01")]).map((x) => x.version)).toEqual(["1.0.1", "2.0.0"]);
    expect(versionLabelError("1.2.3")).toBeNull();
    expect(versionLabelError("1.2.3-rc.1")).not.toBeNull();
    expect(versionLabelError("v1.2.3")).not.toBeNull();
    expect(versionLabelError("1.2")).not.toBeNull();
  });

  it("checks version urls and manifests like registrations", () => {
    expect(versionUrlError("https://example.com/app")).toBeNull();
    expect(versionUrlError("http://localhost:3000/examples/rps/index.html?build=2")).toBeNull();
    expect(versionUrlError("http://example.com")).not.toBeNull();
    expect(versionUrlError("/relative")).not.toBeNull();
    const manifest = manifestOf(getOfficialApp("rps-showdown")!);
    expect(versionManifestError(manifest)).toBeNull();
    expect(versionManifestError({ ...manifest, modes: [] })).not.toBeNull();
    expect(versionManifestError({ ...manifest, category: "nope" })).not.toBeNull();
    expect(versionManifestError({ ...manifest, players: { min: 2, max: 9 } })).not.toBeNull();
    expect(versionManifestError(null)).not.toBeNull();
    expect(cleanManifest({ ...manifest, scoring: "votes", votesToWin: undefined }).votesToWin).toBe(5);
    expect(cleanManifest({ ...manifest, scoring: "high", votesToWin: 3 })).not.toHaveProperty("votesToWin");
  });

  it("publishing copies url + manifest onto the app", () => {
    const app = getOfficialApp("rps-showdown")!;
    const next = applyVersionToApp(app, { url: "https://example.com/next", manifest: { ...manifestOf(app), name: "RPS 2" } });
    expect(next).toMatchObject({ slug: app.slug, name: "RPS 2", url: "https://example.com/next", developer: app.developer });
  });

  it("labels test builds and log levels", () => {
    expect(isTestBuild({ versionId: "v1" })).toBe(true);
    expect(isTestBuild({ versionId: null })).toBe(false);
    expect(isTestBuild(undefined)).toBe(false);
    expect(testBuildLabel({ versionId: "v1", versionLabel: "1.1.0" })).toBe("Test build v1.1.0");
    expect(testBuildLabel({ versionId: "v1" })).toBe("Test build");
    expect(levelsFrom("warn")).toEqual(["warn", "error"]);
  });
});
