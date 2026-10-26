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

# Turns the `mysql://` URL into the arguments the MySQL client tools take.
#
# They accept no connection URL at all, so host, port, user, password and
# schema are passed separately. The password goes through MYSQL_PWD rather than
# --password, which would expose it in the process list to every user on the
# machine.
#
# Emits shell assignments for `eval`; the values are single-quoted with inner
# quotes escaped, so a password containing shell metacharacters survives.
mysql_conn_vars() {
  python3 - "$1" <<'PYEOF'
import sys
from urllib.parse import urlsplit, unquote

parts = urlsplit(sys.argv[1])

if parts.scheme not in ("mysql", "mariadb"):
    sys.exit(f"DATABASE_URL must be a mysql:// connection string, got {parts.scheme}://")

database = unquote(parts.path.lstrip("/"))
if not database:
    sys.exit("DATABASE_URL names no database.")

def quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"

print(f"DB_HOST={quote(parts.hostname or '127.0.0.1')}")
print(f"DB_PORT={quote(str(parts.port or 3306))}")
print(f"DB_USER={quote(unquote(parts.username or 'root'))}")
print(f"DB_NAME={quote(database)}")
print(f"MYSQL_PWD={quote(unquote(parts.password or ''))}")
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

eval "$(mysql_conn_vars "$DATABASE_URL")"
export MYSQL_PWD

MYSQL_ARGS=(--host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER")

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$DEST/$STAMP"
mkdir -p "$TARGET"

echo "==> Backing up the database"
# --single-transaction takes a consistent snapshot without locking writers out,
# which InnoDB supports and which matters on a database serving a booking floor.
#
# --routines and --triggers are included so the dump is the whole schema, not
# only its tables. --no-tablespaces avoids needing the PROCESS privilege, which
# a managed provider will not grant.
#
# Gzipped rather than mysqldump's plain SQL: these dumps are mostly repetitive
# text and compress by roughly an order of magnitude.
mysqldump "${MYSQL_ARGS[@]}" \
  --single-transaction \
  --routines \
  --triggers \
  --no-tablespaces \
  --databases "$DB_NAME" \
  | gzip > "$TARGET/database.sql.gz"

DB_SIZE="$(du -h "$TARGET/database.sql.gz" | cut -f1)"
echo "    database.sql.gz ($DB_SIZE)"

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

# -N drops the column header, -B gives tab-separated output: between them the
# query returns the bare value a shell variable wants.
query() {
  mysql "${MYSQL_ARGS[@]}" -NB --database="$DB_NAME" -e "$1" 2>/dev/null || echo 'unknown'
}

echo "==> Recording what was captured"
{
  echo "taken_at=$STAMP"
  echo "schema_migrations=$(query 'SELECT count(*) FROM `_prisma_migrations` WHERE finished_at IS NOT NULL')"
  for table in AdminUser Customer Booking Payment Refund Document; do
    echo "rows_${table}=$(query "SELECT count(*) FROM \`$table\`")"
  done
} > "$TARGET/manifest.txt"

# Checksums let a restore prove the archive is the one that was written.
( cd "$TARGET" && sha256sum ./* > checksums.sha256 2>/dev/null || true )

echo
sed 's/^/    /' "$TARGET/manifest.txt"

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
