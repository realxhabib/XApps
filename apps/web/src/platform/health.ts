/**
 * Whether the backend's database is reachable. The Supabase backend reports
 * outages here (Supabase down, overloaded or restarting: 5xx, PostgREST's
 * "can't reach the database" codes, network failures) and recoveries; the site
 * shows a banner while it's down and keeps browsing working from the built-in
 * catalog.
 */

import { create } from "zustand";

interface HealthState {
  /** When the current outage was first seen (ms), or null while healthy. */
  downSince: number | null;
}

export const useHealth = create<HealthState>(() => ({ downSince: null }));

export function noteOutage(): void {
  if (useHealth.getState().downSince === null) useHealth.setState({ downSince: Date.now() });
}

export function noteHealthy(): void {
  if (useHealth.getState().downSince !== null) useHealth.setState({ downSince: null });
}

/** PostgREST codes for "the API is up but can't reach Postgres" (connection, schema cache, timeout). */
const UNREACHABLE_CODES = new Set(["PGRST000", "PGRST001", "PGRST002", "PGRST003"]);

/**
 * True when a failed Supabase request means the service is down or overloaded,
 * not that the request was wrong: a 5xx or 408 status, PostgREST's unreachable
 * database codes, or the browser failing to reach Supabase at all (status 0).
 */
export function isOutage(error: { code?: string | null; message?: string | null } | null | undefined, status?: number | null): boolean {
  if (!error) return false;
  if (status === 408 || (typeof status === "number" && status >= 500 && status <= 599)) return true;
  if (error.code && UNREACHABLE_CODES.has(error.code)) return true;
  return /failed to fetch|fetch failed|networkerror|load failed|network request failed|upstream connect|service unavailable/i.test(error.message ?? "");
}

export const OUTAGE_MESSAGE = "XApps can't reach its database right now. Try again in a minute.";
