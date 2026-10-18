#!/usr/bin/env bash
#
# Moves development data from the bundled Prisma Postgres to a system
# PostgreSQL service.
#
# The bundled server (`npm run dev:db`) is a foreground process that stops with
# its terminal. A system service survives reboots, which is why this exists.
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

TARGET_URL="${1:-}"
SOURCE_URL="${SOURCE_DATABASE_URL:-postgres://postgres:postgres@localhost:51214/template1?sslmode=disable}"

if [[ -z "$TARGET_URL" ]]; then
  echo "usage: $0 '<target-connection-string>'" >&2
  echo "example: $0 'postgresql://travel_crm:devpassword@localhost:5432/travel_crm'" >&2
  exit 1
fi

DUMP_FILE="$(mktemp -t crm-migration-XXXXXX.sql)"
# The dump contains real booking and customer rows, so it must not outlive the
# migration regardless of how the script exits.
trap 'rm -f "$DUMP_FILE"' EXIT

echo "==> Checking the source database is reachable"
if ! psql "$SOURCE_URL" -c 'SELECT 1' >/dev/null 2>&1; then
  echo "Cannot reach the source database." >&2
  echo "Start it with 'npm run dev:db' and try again." >&2
  exit 1
fi

echo "==> Checking the target database is reachable"
if ! psql "$TARGET_URL" -c 'SELECT 1' >/dev/null 2>&1; then
  echo "Cannot reach the target database at the supplied connection string." >&2
  exit 1
fi

echo "==> Refusing to overwrite a target that already holds data"
EXISTING=$(psql "$TARGET_URL" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [[ "$EXISTING" != "0" ]]; then
  echo "The target already has $EXISTING table(s) in the public schema." >&2
  echo "Drop them first if you really intend to replace it:" >&2
  echo "  psql '<target>' -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'" >&2
  exit 1
fi

echo "==> Dumping the source"
# --no-owner and --no-privileges keep the dump portable: the target role differs
# from the source's, and restoring ownership grants would fail.
pg_dump "$SOURCE_URL" \
  --no-owner \
  --no-privileges \
  --schema=public \
  --file="$DUMP_FILE"

echo "==> Restoring into the target"
psql "$TARGET_URL" --set ON_ERROR_STOP=on --quiet --file="$DUMP_FILE"

echo "==> Verifying row counts match"
for table in "AdminUser" "Customer" "Booking" "Permission" "Document"; do
  SOURCE_COUNT=$(psql "$SOURCE_URL" -tAc "SELECT count(*) FROM \"$table\"" 2>/dev/null || echo "n/a")
  TARGET_COUNT=$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM \"$table\"" 2>/dev/null || echo "n/a")

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
