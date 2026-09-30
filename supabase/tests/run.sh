#!/usr/bin/env bash
# Verifies supabase/migrations against a throwaway local PostgreSQL database.
# Usage: supabase/tests/run.sh   (needs psql + a local server; PGHOST etc. respected)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="xapps_test_$$"
psql_cmd=(psql -v ON_ERROR_STOP=1 -X -q)
if [ "$(id -u)" = "0" ] && command -v runuser >/dev/null && [ -z "${PGUSER:-}" ]; then
  psql_cmd=(runuser -u postgres -- psql -v ON_ERROR_STOP=1 -X -q)
fi
"${psql_cmd[@]}" -d postgres -c "create database $db" >/dev/null
trap '"${psql_cmd[@]}" -d postgres -c "drop database if exists $db" >/dev/null' EXIT
"${psql_cmd[@]}" -d "$db" -f "$here/stubs.sql"
for f in "$here"/../migrations/*.sql; do
  "${psql_cmd[@]}" -d "$db" -f "$f"
done
# Official apps: replay `npm run sync-apps` (its --dry-run rows) on the migrated schema.
sync_apps="$here/../../apps/web/scripts/sync-apps.mjs"
if command -v node >/dev/null && [ -d "$here/../../node_modules/esbuild" ]; then
  rows="$(node "$sync_apps" --dry-run)"
  "${psql_cmd[@]}" -d "$db" -v rows="$rows" -f "$here/official_apps.sql"
else
  echo "Skipping the official app sync check: needs node and npm install (for esbuild)." >&2
fi
"${psql_cmd[@]}" -d "$db" -f "$here/lifecycle.sql"
"${psql_cmd[@]}" -d "$db" -f "$here/upvotes.sql"
