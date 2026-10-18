#!/usr/bin/env bash
#
# Restores a backup produced by scripts/backup.sh.
#
# Usage:
#   scripts/restore.sh <backup-directory> <target-connection-string> [storage-root]
#
# The target must be an EMPTY database. Restoring over a populated one is
# refused: a half-merged restore is harder to diagnose than a failed one, and
# the usual reason to restore is that the current data is already wrong.
#
# To replace an existing database deliberately:
#   psql '<target>' -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'

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

BACKUP_DIR="${1:-}"
TARGET_URL="${2:-}"
STORAGE_ROOT="${3:-./storage}"

if [[ -z "$BACKUP_DIR" || -z "$TARGET_URL" ]]; then
  echo "usage: $0 <backup-directory> <target-connection-string> [storage-root]" >&2
  exit 1
fi

if [[ ! -f "$BACKUP_DIR/database.dump" ]]; then
  echo "No database.dump in $BACKUP_DIR." >&2
  exit 1
fi

PG_URL="$(strip_prisma_params "$TARGET_URL")"

echo "==> Verifying the archive is intact"
if [[ -f "$BACKUP_DIR/checksums.sha256" ]]; then
  ( cd "$BACKUP_DIR" && sha256sum --quiet --check checksums.sha256 ) \
    && echo "    checksums match" \
    || { echo "    CHECKSUM MISMATCH — this archive is damaged." >&2; exit 1; }
else
  echo "    no checksums recorded; continuing"
fi

echo "==> Checking the target is reachable and empty"
if ! psql "$PG_URL" -c 'SELECT 1' >/dev/null 2>&1; then
  echo "Cannot reach the target database." >&2
  exit 1
fi

EXISTING="$(psql "$PG_URL" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"

if [[ "$EXISTING" != "0" ]]; then
  echo "The target already holds $EXISTING table(s). Refusing to restore over it." >&2
  echo "Drop them first if that is really the intent:" >&2
  echo "  psql '$TARGET_URL' -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'" >&2
  exit 1
fi

echo "==> Restoring the database"
pg_restore \
  --dbname="$PG_URL" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$BACKUP_DIR/database.dump"

echo "==> Restoring the document store"
if [[ -f "$BACKUP_DIR/documents.tar.gz" ]]; then
  # The archive carries the store's ORIGINAL directory name, which need not
  # match the restore target. Unpacking into a scratch directory and moving the
  # contents means a renamed target still receives the files, rather than
  # silently creating the old name beside it.
  SCRATCH="$(mktemp -d)"
  trap 'rm -rf "$SCRATCH"' EXIT

  tar -xzf "$BACKUP_DIR/documents.tar.gz" -C "$SCRATCH"

  INNER="$(find "$SCRATCH" -mindepth 1 -maxdepth 1 -type d | head -1)"
  if [[ -z "$INNER" ]]; then
    echo "    WARNING: the document archive contained no directory" >&2
  else
    mkdir -p "$STORAGE_ROOT"
    cp -a "$INNER/." "$STORAGE_ROOT/"
    RESTORED_COUNT="$(find "$STORAGE_ROOT" -type f | wc -l)"
    echo "    $RESTORED_COUNT document file(s) restored to $STORAGE_ROOT"
  fi
elif [[ -f "$BACKUP_DIR/documents.none" ]]; then
  echo "    the backup recorded no documents"
else
  # Distinct from "none recorded": the archive is incomplete, and every
  # document link in the restored database will be broken.
  echo "    WARNING: no document archive and no empty marker — documents are MISSING" >&2
fi

echo "==> Comparing row counts against the manifest"
if [[ -f "$BACKUP_DIR/manifest.txt" ]]; then
  MISMATCH=0
  while IFS='=' read -r key expected; do
    [[ "$key" == rows_* ]] || continue
    table="${key#rows_}"
    actual="$(psql "$PG_URL" -tAc "SELECT count(*) FROM \"$table\"" 2>/dev/null || echo 'error')"

    if [[ "$actual" == "$expected" ]]; then
      printf '    %-12s %s\n' "$table" "$actual"
    else
      printf '    %-12s MISMATCH expected=%s actual=%s\n' "$table" "$expected" "$actual" >&2
      MISMATCH=1
    fi
  done < "$BACKUP_DIR/manifest.txt"

  if [[ "$MISMATCH" == "1" ]]; then
    echo "Restore finished but the counts do not match the manifest." >&2
    exit 1
  fi
fi

echo
echo "Restore complete and verified against the manifest."
echo "Next: point DATABASE_URL at the restored database and run"
echo "  npx prisma migrate status"
echo "to confirm the schema is at the expected migration."
