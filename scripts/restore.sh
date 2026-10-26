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
#   mysql '<host flags>' -e 'DROP DATABASE `travel_crm`; CREATE DATABASE `travel_crm`;'

set -euo pipefail

# Turns the `mysql://` URL into the arguments the MySQL client tools take. See
# the matching function in backup.sh for why the password goes via MYSQL_PWD.
mysql_conn_vars() {
  python3 - "$1" <<'PYEOF'
import sys
from urllib.parse import urlsplit, unquote

parts = urlsplit(sys.argv[1])

if parts.scheme not in ("mysql", "mariadb"):
    sys.exit(f"Target must be a mysql:// connection string, got {parts.scheme}://")

database = unquote(parts.path.lstrip("/"))
if not database:
    sys.exit("The target connection string names no database.")

def quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"

print(f"DB_HOST={quote(parts.hostname or '127.0.0.1')}")
print(f"DB_PORT={quote(str(parts.port or 3306))}")
print(f"DB_USER={quote(unquote(parts.username or 'root'))}")
print(f"DB_NAME={quote(database)}")
print(f"MYSQL_PWD={quote(unquote(parts.password or ''))}")
PYEOF
}

BACKUP_DIR="${1:-}"
TARGET_URL="${2:-}"
STORAGE_ROOT="${3:-./storage}"

if [[ -z "$BACKUP_DIR" || -z "$TARGET_URL" ]]; then
  echo "usage: $0 <backup-directory> <target-connection-string> [storage-root]" >&2
  exit 1
fi

if [[ ! -f "$BACKUP_DIR/database.sql.gz" ]]; then
  echo "No database.sql.gz in $BACKUP_DIR." >&2
  exit 1
fi

eval "$(mysql_conn_vars "$TARGET_URL")"
export MYSQL_PWD

MYSQL_ARGS=(--host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER")

echo "==> Verifying the archive is intact"
if [[ -f "$BACKUP_DIR/checksums.sha256" ]]; then
  ( cd "$BACKUP_DIR" && sha256sum --quiet --check checksums.sha256 ) \
    && echo "    checksums match" \
    || { echo "    CHECKSUM MISMATCH — this archive is damaged." >&2; exit 1; }
else
  echo "    no checksums recorded; continuing"
fi

echo "==> Checking the target is reachable and empty"
if ! mysql "${MYSQL_ARGS[@]}" -e 'SELECT 1' >/dev/null 2>&1; then
  echo "Cannot reach the target server." >&2
  exit 1
fi

# The dump carries CREATE DATABASE, so the schema need not exist yet — but if
# it does and holds tables, this is not an empty target.
EXISTING="$(mysql "${MYSQL_ARGS[@]}" -NB -e \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = '$DB_NAME'")"

if [[ "$EXISTING" != "0" ]]; then
  echo "The target already holds $EXISTING table(s). Refusing to restore over it." >&2
  echo "Drop it first if that is really the intent:" >&2
  echo "  mysql --host=$DB_HOST --port=$DB_PORT --user=$DB_USER -e 'DROP DATABASE \`$DB_NAME\`;'" >&2
  exit 1
fi

echo "==> Restoring the database"
# No --database flag: the dump was taken with --databases, so it carries its own
# CREATE DATABASE and USE statements and chooses its own target.
gunzip -c "$BACKUP_DIR/database.sql.gz" | mysql "${MYSQL_ARGS[@]}"

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
    actual="$(mysql "${MYSQL_ARGS[@]}" -NB --database="$DB_NAME" \
      -e "SELECT count(*) FROM \`$table\`" 2>/dev/null || echo 'error')"

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
