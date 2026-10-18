#!/usr/bin/env bash
#
# Backs up the database and the document store.
#
# Both are required for a usable restore. The database holds document metadata
# and storage keys; the object store holds the bytes. A database-only backup
# restores to a system whose every document link is broken.
#
# Usage:
#   scripts/backup.sh [destination-directory]
#
# Environment:
#   DATABASE_URL        read from .env when not set
#   STORAGE_LOCAL_ROOT  document store, defaults to ./storage
#   BACKUP_RETAIN_DAYS  prune older backups, defaults to 30

set -euo pipefail

# Prisma accepts connection-string parameters the libpq tools reject, notably
# `schema` and the pool tuning options. They are stripped before pg_dump,
# pg_restore or psql sees the URL.
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

cd "$(dirname "$0")/.."

# Load .env without exporting comments or blank lines.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^[A-Z_]+=' .env | sed 's/^/export /' | sed 's/export //')
  set +a
fi

DEST="${1:-./backups}"
DATABASE_URL="${DATABASE_URL:-}"
STORAGE_ROOT="${STORAGE_LOCAL_ROOT:-./storage}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

if [[ -z "$DATABASE_URL" ]]; then
  echo "DATABASE_URL is not set and could not be read from .env." >&2
  exit 1
fi

PG_URL="$(strip_prisma_params "$DATABASE_URL")"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$DEST/$STAMP"
mkdir -p "$TARGET"

echo "==> Backing up the database"
# Custom format: compressed, and restorable selectively with pg_restore.
pg_dump "$PG_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$TARGET/database.dump"

DB_SIZE="$(du -h "$TARGET/database.dump" | cut -f1)"
echo "    database.dump ($DB_SIZE)"

echo "==> Backing up the document store"
if [[ -d "$STORAGE_ROOT" ]] && [[ -n "$(ls -A "$STORAGE_ROOT" 2>/dev/null)" ]]; then
  tar -czf "$TARGET/documents.tar.gz" -C "$(dirname "$STORAGE_ROOT")" \
    "$(basename "$STORAGE_ROOT")"
  DOC_SIZE="$(du -h "$TARGET/documents.tar.gz" | cut -f1)"
  echo "    documents.tar.gz ($DOC_SIZE)"
else
  echo "    no documents stored yet"
  # An explicit empty marker, so a restore can tell "no documents" from
  # "the document backup was lost".
  : > "$TARGET/documents.none"
fi

echo "==> Recording what was captured"
{
  echo "taken_at=$STAMP"
  echo "schema_migrations=$(psql "$PG_URL" -tAc \
    'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL' 2>/dev/null || echo 'unknown')"
  for table in AdminUser Customer Booking Payment Refund Document; do
    echo "rows_${table}=$(psql "$PG_URL" -tAc "SELECT count(*) FROM \"$table\"" 2>/dev/null || echo 'unknown')"
  done
} > "$TARGET/manifest.txt"

# Checksums let a restore prove the archive is the one that was written.
( cd "$TARGET" && sha256sum ./* > checksums.sha256 2>/dev/null || true )

echo
cat "$TARGET/manifest.txt" | sed 's/^/    /'

if [[ "$RETAIN_DAYS" -gt 0 ]]; then
  echo
  echo "==> Pruning backups older than $RETAIN_DAYS days"
  find "$DEST" -maxdepth 1 -type d -name '20*Z' -mtime "+$RETAIN_DAYS" \
    -exec rm -rf {} + 2>/dev/null || true
fi

echo
echo "Backup complete: $TARGET"
echo "A backup is not proven until it has been restored. Run:"
echo "  scripts/restore.sh $TARGET '<target-connection-string>'"
