#!/usr/bin/env bash
#
# Moves the development database to another PostgreSQL server.
#
# The source defaults to whatever DATABASE_URL in .env points at, so this works
# regardless of which server is currently in use. The target is given on the
# command line.
#
# Prerequisites — the target role and database must already exist:
#   sudo -u postgres psql -c "CREATE ROLE travel_crm LOGIN PASSWORD '<password>';"
#   sudo -u postgres psql -c "CREATE DATABASE travel_crm OWNER travel_crm;"
#
# Usage:
#   scripts/migrate-to-system-postgres.sh '<target-connection-string>'
#
# The bundled server must be running (`npm run dev:db`) so there is something
# to copy from.

set -euo pipefail

# Prisma accepts connection-string parameters the libpq tools reject, notably
# `schema` and the pool tuning options.
strip_prisma_params() {
  python3 - "$1" <<'PYEOF'
import sys
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

PRISMA_ONLY = {
    "schema", "connection_limit", "pool_timeout", "connect_timeout",
    "socket_timeout", "max_idle_connection_lifetime", "pgbouncer",
    "sslidentity", "sslpassword",
}

parts = urlsplit(sys.argv[1])
kept = [(k, v) for k, v in parse_qsl(parts.query) if k not in PRISMA_ONLY]
print(urlunsplit(parts._replace(query=urlencode(kept))))
PYEOF
}

TARGET_URL="${1:-}"
# Source: explicit override, else whatever .env currently points at.
if [[ -z "${SOURCE_DATABASE_URL:-}" && -f .env ]]; then
  SOURCE_DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"
fi
SOURCE_URL="${SOURCE_DATABASE_URL:-}"

if [[ -z "$SOURCE_URL" ]]; then
  echo "No source database. Set SOURCE_DATABASE_URL or DATABASE_URL in .env." >&2
  exit 1
fi

if [[ -z "$TARGET_URL" ]]; then
  echo "usage: $0 '<target-connection-string>'" >&2
  echo "example: $0 'postgresql://travel_crm:devpassword@localhost:5432/travel_crm'" >&2
  exit 1
fi

SOURCE_PG="$(strip_prisma_params "$SOURCE_URL")"
TARGET_PG="$(strip_prisma_params "$TARGET_URL")"

DUMP_FILE="$(mktemp -t crm-migration-XXXXXX.dump)"
# The dump contains real booking and customer rows, so it must not outlive the
# migration regardless of how the script exits.
trap 'rm -f "$DUMP_FILE"' EXIT

echo "==> Checking the source database is reachable"
if ! psql "$SOURCE_PG" -c 'SELECT 1' >/dev/null 2>&1; then
  echo "Cannot reach the source database at the URL in .env." >&2
  echo "Start it with 'npm run dev:db' and try again." >&2
  exit 1
fi

echo "==> Checking the target database is reachable"
if ! psql "$TARGET_PG" -c 'SELECT 1' >/dev/null 2>&1; then
  echo "Cannot reach the target database at the supplied connection string." >&2
  exit 1
fi

echo "==> Refusing to overwrite a target that already holds data"
EXISTING=$(psql "$TARGET_PG" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [[ "$EXISTING" != "0" ]]; then
  echo "The target already has $EXISTING table(s) in the public schema." >&2
  echo "Drop them first if you really intend to replace it:" >&2
  echo "  psql '<target>' -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'" >&2
  exit 1
fi

echo "==> Dumping the source"
# Custom format so pg_restore can be selective. --no-owner and --no-privileges
# keep the dump portable: the target role differs from the source's, and
# restoring ownership grants would fail.
pg_dump "$SOURCE_PG" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --file="$DUMP_FILE"

echo "==> Restoring into the target"
# Not --exit-on-error: a dump recreates `public`, which every database already
# has, and that benign conflict would abort an otherwise good restore. The row
# count comparison below is the real gate — it fails the migration outright if
# anything genuinely did not arrive.
RESTORE_LOG="$(mktemp)"
trap 'rm -f "$DUMP_FILE" "$RESTORE_LOG"' EXIT

if ! pg_restore --dbname="$TARGET_PG" --no-owner --no-privileges \
     "$DUMP_FILE" 2>"$RESTORE_LOG"; then
  # Report anything that is not the known-harmless schema conflict. The
  # "errors ignored on restore" tally is suppressed too, since it only counts
  # that same conflict — leaving it in would make every clean run look dirty.
  if grep -vE 'schema "public" already exists|errors ignored on restore' \
       "$RESTORE_LOG" | grep -q 'error'; then
    echo "Restore reported errors:" >&2
    grep 'error' "$RESTORE_LOG" | head -20 >&2
  fi
fi

echo "==> Verifying row counts match"
for table in "AdminUser" "Customer" "Booking" "Permission" "Document"; do
  SOURCE_COUNT=$(psql "$SOURCE_PG" -tAc "SELECT count(*) FROM \"$table\"" 2>/dev/null || echo "n/a")
  TARGET_COUNT=$(psql "$TARGET_PG" -tAc "SELECT count(*) FROM \"$table\"" 2>/dev/null || echo "n/a")

  if [[ "$SOURCE_COUNT" == "$TARGET_COUNT" ]]; then
    printf '    %-12s %s\n' "$table" "$SOURCE_COUNT"
  else
    printf '    %-12s MISMATCH source=%s target=%s\n' "$table" "$SOURCE_COUNT" "$TARGET_COUNT" >&2
    exit 1
  fi
done

echo
echo "Migration complete. Next:"
echo "  1. Point DATABASE_URL in .env at the target."
echo "  2. Remove SHADOW_DATABASE_URL — a system Postgres creates its own."
echo "  3. Run 'npx prisma migrate status' to confirm migrations are in sync."
echo "  4. Stop 'npm run dev:db'; it is no longer needed."
