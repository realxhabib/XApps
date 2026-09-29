import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { LIMITS, type Json } from "@xapps/sdk";
import { env, isSupabaseConfigured } from "@/lib/env";

/**
 * Shared plumbing for the Stage 2 server API (`/api/v1/*`), called by app
 * servers with `Authorization: Bearer xas_…`. Route handlers stay thin: they
 * pick a body parser, an RPC and a response shape, and `runServerApi` does
 * the rest (demo-mode check, auth header, body validation, RPC, error
 * mapping). Errors are `{ error: { code, message } }`, every response is
 * `Cache-Control: no-store`.
 */

export type ServerApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_state"
  | "invalid_params"
  | "rate_limited"
  | "internal"
  | "not_configured";

export class ServerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ServerApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ServerApiError";
  }
}

const NO_STORE = { "Cache-Control": "no-store" };

export function apiJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function apiError(error: ServerApiError): Response {
  return apiJson({ error: { code: error.code, message: error.message } }, error.status);
}

/* ------------------------------------------------------------------ */
/* Auth header & ids                                                  */
/* ------------------------------------------------------------------ */

const SECRET_RE = /^xas_[0-9a-f]{48}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The app secret from `Authorization: Bearer xas_<48 hex>`, or null when missing/malformed. */
export function parseBearer(header: string | null | undefined): string | null {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header ?? "");
  const secret = match?.[1];
  return secret && SECRET_RE.test(secret) ? secret : null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/* ------------------------------------------------------------------ */
/* Body validation (422)                                              */
/* ------------------------------------------------------------------ */

/** Max request body we read at all. The state limit is checked separately. */
export const MAX_BODY_BYTES = LIMITS.matchStateBytes + 16 * 1024;

function invalid(message: string): never {
  throw new ServerApiError(422, "invalid_params", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!isPlainObject(body)) invalid("Body must be a JSON object");
  return body;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export interface StateBody {
  state: Json;
  expectedVersion: number;
}

export function parseStateBody(body: unknown): StateBody {
  const b = objectBody(body);
  if (!("state" in b) || b.state === undefined) invalid("`state` is required (use null to clear it)");
  if (!isNonNegativeInt(b.expectedVersion)) invalid("`expectedVersion` must be a non-negative integer");
  const bytes = new TextEncoder().encode(JSON.stringify(b.state)).length;
  if (bytes > LIMITS.matchStateBytes) {
    invalid(`\`state\` is ${bytes} bytes; the limit is ${LIMITS.matchStateBytes}`);
  }
  return { state: b.state as Json, expectedVersion: b.expectedVersion };
}

export interface TurnBody {
  next: string | null;
}

export function parseTurnBody(body: unknown): TurnBody {
  const b = body === undefined ? {} : objectBody(body);
  if (b.next === undefined || b.next === null) return { next: null };
  if (!isUuid(b.next)) invalid("`next` must be a player id");
  return { next: b.next };
}

export interface RoundBody {
  round: number;
}

export function parseRoundBody(body: unknown): RoundBody {
  const b = objectBody(body);
  if (!isNonNegativeInt(b.round)) invalid("`round` must be a non-negative integer");
  return { round: b.round };
}

export interface ResultBody {
  scores?: { [userId: string]: number };
  ranks?: { [userId: string]: number };
  leavers?: string[];
}

const MAX_RESULT_ENTRIES = 64;

function playerMap(
  value: unknown,
  name: string,
  valid: (n: unknown) => n is number,
  what: string,
): { [userId: string]: number } {
  if (!isPlainObject(value)) invalid(`\`${name}\` must be an object of player id → number`);
  const entries = Object.entries(value);
  if (!entries.length) invalid(`\`${name}\` is empty`);
  if (entries.length > MAX_RESULT_ENTRIES) invalid(`\`${name}\` has too many entries`);
  for (const [id, n] of entries) {
    if (!isUuid(id)) invalid(`\`${name}\`: "${String(id).slice(0, 64)}" is not a player id`);
    if (!valid(n)) invalid(`\`${name}.${id}\` must be ${what}`);
  }
  return value as { [userId: string]: number };
}

const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isRank = (n: unknown): n is number => isNonNegativeInt(n) && n >= 1;

/** `{ scores }` or `{ ranks }` (ranks win if both are given, in SQL), plus optional `leavers`. */
export function parseResultBody(body: unknown): ResultBody {
  const b = objectBody(body);
  if (b.scores === undefined && b.ranks === undefined) invalid("Pass `scores` or `ranks`");
  const result: ResultBody = {};
  if (b.scores !== undefined) result.scores = playerMap(b.scores, "scores", isFiniteNumber, "a finite number");
  if (b.ranks !== undefined) result.ranks = playerMap(b.ranks, "ranks", isRank, "a positive integer");
  if (b.leavers !== undefined) {
    if (!Array.isArray(b.leavers) || b.leavers.length > MAX_RESULT_ENTRIES || !b.leavers.every(isUuid)) {
      invalid("`leavers` must be an array of player ids");
    }
    result.leavers = [...new Set(b.leavers as string[])];
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Stage 3: storage, stats & achievements                             */
/* ------------------------------------------------------------------ */

/** Stat keys and achievement ids: `^[a-z][a-z0-9_]{0,31}$`. */
export const DEF_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

/** A storage key from the URL: 1–64 characters, no control characters. */
export function parseStorageKey(raw: string): string {
  let key = raw;
  // Route params arrive decoded; tolerate a client that double-encoded the key.
  if (/%[0-9a-f]{2}/i.test(key)) {
    try {
      key = decodeURIComponent(key);
    } catch {
      // keep it as is
    }
  }
  if (!key || key.length > LIMITS.storageKeyLength || /[\u0000-\u001f\u007f]/.test(key)) {
    invalid(`The storage key must be 1–${LIMITS.storageKeyLength} characters`);
  }
  return key;
}

export interface StorageValueBody {
  value: Json;
}

/** `PUT /api/v1/storage/:key` → `{ value }` (any JSON, ≤ 64 KB serialized). */
export function parseStorageValueBody(body: unknown): StorageValueBody {
  const b = objectBody(body);
  if (!("value" in b) || b.value === undefined) invalid("`value` is required (DELETE the key to remove it)");
  const bytes = new TextEncoder().encode(JSON.stringify(b.value)).length;
  if (bytes > LIMITS.storageValueBytes) invalid(`\`value\` is ${bytes} bytes; the limit is ${LIMITS.storageValueBytes}`);
  return { value: b.value as Json };
}

export interface StatsBody {
  userId: string;
  values: { [key: string]: number };
}

/** `POST /api/v1/stats` → `{ userId, values: { [statKey]: number } }` (1–8 stats). */
export function parseStatsBody(body: unknown): StatsBody {
  const b = objectBody(body);
  if (!isUuid(b.userId)) invalid("`userId` must be a player id");
  if (!isPlainObject(b.values)) invalid("`values` must be an object of stat key → number");
  const entries = Object.entries(b.values);
  if (!entries.length) invalid("`values` is empty");
  if (entries.length > LIMITS.maxStats) invalid(`\`values\` can hold at most ${LIMITS.maxStats} stats`);
  for (const [key, value] of entries) {
    if (!DEF_ID_RE.test(key)) invalid(`\`values\`: "${key.slice(0, 64)}" is not a stat key`);
    if (!isFiniteNumber(value)) invalid(`\`values.${key}\` must be a finite number`);
  }
  return { userId: b.userId, values: b.values as { [key: string]: number } };
}

export interface AchievementBody {
  userId: string;
  id: string;
}

/** `POST /api/v1/achievements` → `{ userId, id }`. */
export function parseAchievementBody(body: unknown): AchievementBody {
  const b = objectBody(body);
  if (!isUuid(b.userId)) invalid("`userId` must be a player id");
  if (typeof b.id !== "string" || !DEF_ID_RE.test(b.id)) invalid("`id` must be an achievement id from your manifest");
  return { userId: b.userId, id: b.id };
}

/* ------------------------------------------------------------------ */
/* Postgres → HTTP                                                    */
/* ------------------------------------------------------------------ */

export interface PgLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

interface PgErrorRule {
  /** SQLSTATEs that match this rule. */
  sqlstates: readonly string[];
  /** Case-insensitive substrings of the error message that also match. */
  messages?: readonly string[];
  status: number;
  code: ServerApiErrorCode;
  /** Used when the database message is empty, or always when `fixedMessage`. */
  message: string;
  fixedMessage?: boolean;
}

/**
 * The single source of truth for mapping errors from the `app_api_*` RPCs.
 * First matching rule wins; anything else is a 500.
 */
export const PG_ERROR_RULES: readonly PgErrorRule[] = [
  {
    sqlstates: ["28000", "28P01"],
    messages: ["invalid_secret"],
    status: 401,
    code: "unauthorized",
    message: "Invalid app secret",
    fixedMessage: true,
  },
  { sqlstates: ["42501"], status: 403, code: "forbidden", message: "This match belongs to another app" },
  { sqlstates: ["P0002"], status: 404, code: "not_found", message: "Match not found" },
  {
    sqlstates: ["40001"],
    messages: ["state_conflict"],
    status: 409,
    code: "conflict",
    message: "The state changed since expectedVersion; re-read and retry",
  },
  { sqlstates: ["55000"], status: 409, code: "invalid_state", message: "The match doesn't allow that right now" },
  { sqlstates: ["22023", "22P02", "23514"], status: 422, code: "invalid_params", message: "Invalid parameters" },
  // Stage 3 limits: 200 app-scope storage keys.
  { sqlstates: ["54000"], status: 429, code: "rate_limited", message: "Limit reached" },
];

export function mapPgError(error: PgLikeError): ServerApiError {
  const sqlstate = error.code ?? "";
  const text = (error.message ?? "").trim();
  const lower = text.toLowerCase();
  const rule = PG_ERROR_RULES.find(
    (r) => r.sqlstates.includes(sqlstate) || r.messages?.some((m) => lower.includes(m.toLowerCase())),
  );
  if (!rule) return new ServerApiError(500, "internal", "Internal error");
  const useDb = !rule.fixedMessage && text && !rule.messages?.some((m) => lower === m.toLowerCase());
  return new ServerApiError(rule.status, rule.code, useDb ? text : rule.message);
}

/* ------------------------------------------------------------------ */
/* Runner                                                             */
/* ------------------------------------------------------------------ */

export type RpcCall = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: PgLikeError | null }>;

export interface ServerApiDeps {
  configured: boolean;
  rpc: RpcCall;
}

let anonClient: SupabaseClient | null = null;

/** Supabase with the publishable/anon key and no user session: the RPCs authenticate by app secret. */
export function getServerApiSupabase(): SupabaseClient {
  anonClient ??= createClient(env.supabaseUrl, env.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return anonClient;
}

function defaultDeps(): ServerApiDeps {
  return {
    configured: isSupabaseConfigured,
    rpc: (fn, args) => getServerApiSupabase().rpc(fn, args),
  };
}

export interface ServerApiRoute<B> {
  /** Validates the JSON body; omit for bodyless requests (GET). */
  parse?: (body: unknown) => B;
  rpc: string;
  /** RPC params besides `p_secret` (and `p_match` / the route's target). */
  args?: (body: B) => Record<string, unknown>;
  /** Success body from the RPC's return value. */
  respond: (data: unknown) => unknown;
}

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_BODY_BYTES) invalid("Body too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) invalid("Body too large");
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    invalid("Body is not valid JSON");
  }
}

/** Match routes (`/api/v1/matches/:id/…`): the RPC gets `p_secret` and `p_match`. */
export async function runServerApi<B>(
  request: Request,
  params: Promise<{ id: string }>,
  route: ServerApiRoute<B>,
  deps: ServerApiDeps = defaultDeps(),
): Promise<Response> {
  return execute(request, route, deps, async () => {
    const { id } = await params;
    if (!isUuid(id)) throw new ServerApiError(404, "not_found", "Match not found");
    return { p_match: id };
  });
}

export interface AppServerApiRoute<B> extends ServerApiRoute<B> {
  /** RPC params taken from the URL (validated; throw a ServerApiError to refuse). */
  target?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

/** App-level routes (`/api/v1/storage`, `/stats`, `/achievements`): the RPC gets `p_secret` plus the route's args. */
export async function runAppServerApi<B>(
  request: Request,
  route: AppServerApiRoute<B>,
  deps: ServerApiDeps = defaultDeps(),
): Promise<Response> {
  return execute(request, route, deps, async () => (route.target ? route.target() : {}));
}

async function execute<B>(
  request: Request,
  route: ServerApiRoute<B>,
  deps: ServerApiDeps,
  target: () => Promise<Record<string, unknown>>,
): Promise<Response> {
  try {
    if (!deps.configured) {
      throw new ServerApiError(
        501,
        "not_configured",
        "The server API needs Supabase; this XApps host runs in demo mode (no NEXT_PUBLIC_SUPABASE_URL / key).",
      );
    }
    const secret = parseBearer(request.headers.get("authorization"));
    if (!secret) {
      throw new ServerApiError(401, "unauthorized", "Missing or malformed `Authorization: Bearer xas_…` header");
    }
    const targetArgs = await target();

    const body = route.parse ? route.parse(await readJson(request)) : (undefined as B);
    const { data, error } = await deps.rpc(route.rpc, {
      p_secret: secret,
      ...targetArgs,
      ...(route.args ? route.args(body) : {}),
    });
    if (error) {
      const mapped = mapPgError(error);
      if (mapped.status >= 500) console.error(`[api/v1] ${route.rpc} failed`, error);
      throw mapped;
    }
    return apiJson(route.respond(data));
  } catch (error) {
    if (error instanceof ServerApiError) return apiError(error);
    console.error("[api/v1] unexpected error", error);
    return apiError(new ServerApiError(500, "internal", "Internal error"));
  }
}

/* ------------------------------------------------------------------ */
/* Response shapes                                                    */
/* ------------------------------------------------------------------ */

export function respondMatch(data: unknown): unknown {
  if (!isPlainObject(data)) throw new ServerApiError(404, "not_found", "Match not found");
  return data;
}

export function respondVersion(data: unknown): { version: number } {
  const version = isPlainObject(data) ? data.version : data;
  if (typeof version !== "number" || !Number.isSafeInteger(version)) {
    throw new ServerApiError(500, "internal", "Unexpected response from the database");
  }
  return { version };
}

export function respondOk(): { ok: true } {
  return { ok: true };
}

/** `report_stats`-style jsonb `{ [key]: number }` → `{ values }`. */
export function respondStatValues(data: unknown): { values: { [key: string]: number } } {
  const raw = Array.isArray(data) ? data[0] : data;
  if (!isPlainObject(raw)) return { values: {} };
  const values: { [key: string]: number } = {};
  for (const [key, value] of Object.entries(raw)) {
    const n = typeof value === "string" ? Number(value) : value;
    if (typeof n === "number" && Number.isFinite(n)) values[key] = n;
  }
  return { values };
}

/** `{ unlocked }` (or a bare boolean) → `{ unlocked }`. */
export function respondUnlocked(data: unknown): { unlocked: boolean } {
  const raw = Array.isArray(data) ? data[0] : data;
  if (typeof raw === "boolean") return { unlocked: raw };
  if (isPlainObject(raw) && typeof raw.unlocked === "boolean") return { unlocked: raw.unlocked };
  throw new ServerApiError(500, "internal", "Unexpected response from the database");
}
