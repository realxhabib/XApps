// Upserts the first-party ("official") apps from src/platform/catalog.ts into
// Supabase `public.apps`, so shipping or changing a first-party app needs no
// migration (migrations only mean "the platform changed").
//
//   npm run sync-apps              sync (needs NEXT_PUBLIC_SUPABASE_URL + a service role key)
//   npm run sync-apps -- --dry-run print the rows as JSON on stdout; never connects
//   npm run sync-apps -- --catalog-slugs  print every catalog slug as JSON; never connects
//
// An official row whose slug the catalog no longer has is retired: its status
// becomes `rejected` (hidden, and every play RPC refuses it) and its open,
// pending and active matches are cancelled. The row, its finished matches and
// the XP they earned stay; putting the app back in the catalog republishes it.
//
// Env (from the environment or apps/web/.env*.local, like `next build`):
// NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY
// (or SUPABASE_SECRET_KEY, the sb_secret_… key). Without a key it skips and
// exits 0, so builds without Supabase are unaffected. SYNC_APPS=off skips;
// Vercel preview/development builds skip unless SYNC_APPS=always (a preview
// must not publish its catalog to the production database). `--build` is how
// `npm run build` calls it: a failure explains that it is failing the build.
//
// The mapping lives in src/platform/official-apps.ts (unit tested); this file
// only bundles it with esbuild (the catalog imports the SDK from source) and
// does the I/O. Secret values are never printed.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const buildMode = args.has("--build");
const log = (...parts) => console.error(...parts);

if (args.has("--help") || args.has("-h")) {
  log("Usage: npm run sync-apps [-- --dry-run | --catalog-slugs]");
  log("Upserts official apps from src/platform/catalog.ts into Supabase public.apps and retires");
  log("official apps the catalog no longer has.");
  process.exit(0);
}

/** src/platform/official-apps.ts, bundled with the catalog and the SDK source it imports. */
async function loadOfficialApps() {
  const result = await build({
    entryPoints: [resolve(web, "src/platform/official-apps.ts")],
    absWorkingDir: web,
    tsconfig: resolve(web, "tsconfig.json"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

function fail(message) {
  log(`sync-apps: ✖ ${message}`);
  if (buildMode) {
    log(
      "sync-apps: ✖ Failing the build: the database would not match this deploy's app catalog.\n" +
        "            Fix the error above, or set SYNC_APPS=off (or remove SUPABASE_SERVICE_ROLE_KEY /\n" +
        "            SUPABASE_SECRET_KEY) to deploy without syncing official apps.",
    );
  }
  process.exit(1);
}

let mod;
let rows;
try {
  mod = await loadOfficialApps();
  rows = mod.officialAppRows();
} catch (error) {
  fail(`could not read the official apps from src/platform/catalog.ts: ${error?.message ?? error}`);
}

if (args.has("--catalog-slugs")) {
  process.stdout.write(`${JSON.stringify(mod.catalogSlugs())}\n`);
  process.exit(0);
}

if (dryRun) {
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  log(`sync-apps: dry run — ${rows.length} official app row(s) above (${rows.map((r) => r.slug).join(", ")}); nothing written.`);
  process.exit(0);
}

// Same .env files as `next build` (.env.production.local, .env.local, .env…);
// variables already set (Vercel, the shell) win.
const requireFromNext = createRequire(createRequire(import.meta.url).resolve("next/package.json"));
requireFromNext("@next/env").loadEnvConfig(web, false, { info() {}, error: log });

const mode = (process.env.SYNC_APPS || "").trim().toLowerCase();
if (mode === "off") {
  log("sync-apps: skipped (SYNC_APPS=off).");
  process.exit(0);
}
const vercelEnv = (process.env.VERCEL_ENV || "").trim();
if (vercelEnv && vercelEnv !== "production" && mode !== "always") {
  log(`sync-apps: skipped on this Vercel ${vercelEnv} build (only production builds sync; SYNC_APPS=always overrides).`);
  process.exit(0);
}

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const keyName = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_SECRET_KEY";
const key = (process.env[keyName] || "").trim();
if (!key) {
  log(
    "sync-apps: skipped — SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY is not set, so official apps were not synced\n" +
      "           to Supabase (fine for demo mode and local builds).",
  );
  process.exit(0);
}
if (!url) fail(`${keyName} is set but NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not.`);
if (key.startsWith("sb_publishable_")) fail(`${keyName} holds a publishable key; use the service_role / sb_secret_ key.`);
let host;
try {
  host = new URL(url).host;
} catch {
  fail("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
}

const { createClient } = await import("@supabase/supabase-js");
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }) },
});
const columns = mod.OFFICIAL_APP_COLUMNS.join(",");
const slugs = rows.map((r) => r.slug);

function dbError(what, error) {
  const hint =
    error.code === "42501" || /permission|row-level security/i.test(error.message ?? "")
      ? ` (is ${keyName} the service_role / secret key?)`
      : error.code === "PGRST205" || error.code === "42P01"
        ? " (is the schema installed? run supabase/migrations first)"
        : "";
  // No stack traces; network errors keep their "Caused by" line.
  const clean = (text) =>
    String(text)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("at "))
      .slice(0, 3)
      .join(" ");
  const parts = [error.message, error.details, error.hint].filter(Boolean).map(clean);
  const detail = [...new Set(parts)].join(" — ");
  return `${what}: ${detail}${error.code ? ` [${error.code}]` : ""}${hint}`;
}

async function fetchRows() {
  const { data, error } = await supabase.from("apps").select(columns).in("slug", slugs);
  if (error) fail(dbError("could not read public.apps", error));
  return data;
}

log(`sync-apps: syncing ${rows.length} official app(s) to ${host}…`);
const plan = mod.planOfficialAppSync(rows, await fetchRows());
const conflicts = plan.filter((s) => s.action === "conflict");
if (conflicts.length) {
  for (const s of conflicts) log(`  ✖ ${s.slug}: ${s.reason}`);
  fail(`${conflicts.length} official app slug(s) are taken; nothing was written.`);
}

const changes = plan.filter((s) => s.action === "insert" || s.action === "update");
if (changes.length) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("apps")
    .upsert(
      changes.map((s) => ({ ...s.row, updated_at: now })),
      { onConflict: "slug" },
    );
  if (error) fail(dbError("upsert into public.apps failed", error));
}

// Read back: a trigger or constraint that rewrote a value would leave drift.
const after = mod.planOfficialAppSync(rows, await fetchRows());
const drift = after.filter((s) => s.action !== "unchanged");

for (const s of plan) {
  if (s.action === "insert") log(`  + inserted   ${s.slug}`);
  else if (s.action === "update") log(`  ~ updated    ${s.slug} (${s.changed.join(", ")})`);
  else log(`  = unchanged  ${s.slug}`);
}

// Official apps the catalog dropped are retired (after the upsert, so a failed sync retires nothing).
const { data: others, error: othersError } = await supabase
  .from("apps")
  .select("slug,official,status")
  .eq("official", true)
  .not("slug", "in", `(${mod.catalogSlugs().join(",")})`);
if (othersError) fail(dbError("could not list official apps", othersError));
const retirement = mod.planOfficialAppRetirement(others ?? []);
const toRetire = retirement.filter((s) => s.action === "retire").map((s) => s.slug);
if (toRetire.length) {
  const { error } = await supabase
    .from("apps")
    .update({ status: mod.RETIRED_STATUS, updated_at: new Date().toISOString() })
    .in("slug", toRetire)
    .eq("official", true);
  if (error) fail(dbError("could not retire official apps", error));
}
const cancelled = new Map();
if (retirement.length) {
  const { data, error } = await supabase
    .from("matches")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .in("app_slug", retirement.map((s) => s.slug))
    .in("status", [...mod.RETIRED_MATCH_STATUSES])
    .select("app_slug");
  if (error) fail(dbError("could not cancel a retired app's unfinished matches", error));
  for (const { app_slug } of data ?? []) cancelled.set(app_slug, (cancelled.get(app_slug) ?? 0) + 1);
}
for (const s of retirement) {
  const n = cancelled.get(s.slug) ?? 0;
  const matches = n ? `; ${n} unfinished match${n === 1 ? "" : "es"} cancelled` : "";
  log(`  - ${s.action === "retire" ? "retired   " : "(retired) "} ${s.slug} (not in the catalog${matches})`);
}

if (drift.length) {
  fail(
    "after the upsert these rows still differ from the catalog (a trigger or constraint rewrote them): " +
      drift.map((s) => `${s.slug} (${s.action === "insert" ? "missing" : s.changed.join(", ")})`).join("; "),
  );
}
const count = (action) => plan.filter((s) => s.action === action).length;
log(
  `sync-apps: ✔ ${count("insert")} inserted, ${count("update")} updated, ${count("unchanged")} unchanged` +
    (retirement.length ? `, ${toRetire.length} retired (${retirement.length} not in the catalog).` : "."),
);
