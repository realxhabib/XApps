/** Bump helpers for the version editor; ordering comes from the platform's rules. */
import { compareSemver } from "@/platform/shipping";

export type Bump = "patch" | "minor" | "major";

const CORE = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})/;

/** MAJOR.MINOR.PATCH of a label (a prerelease suffix is ignored). */
export function parseSemver(version: string): [number, number, number] | null {
  const m = CORE.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export { compareSemver };

export function bumpSemver(version: string, bump: Bump): string {
  const [major, minor, patch] = parseSemver(version) ?? [1, 0, 0];
  // 1.2.0-beta.1 → patch releases 1.2.0 itself.
  if (bump === "patch" && /-/.test(version)) return `${major}.${minor}.${patch}`;
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** The highest version in a list (or null when there are none). */
export function latestSemver(versions: string[]): string | null {
  return versions.reduce<string | null>((best, v) => (best === null || compareSemver(v, best) > 0 ? v : best), null);
}
