#!/usr/bin/env bash
#
# Starts a real PostgreSQL for development, using the server binaries already
# installed on this machine.
#
# Why this exists: the bundled `prisma dev` server could not serve the booking
# detail query — a findUnique across ten relations — and closed the connection
# every time, producing a 500 on the page. The identical query succeeds on a
# real PostgreSQL. The application was never at fault, but development and the
# end-to-end suite were unusable until the database was replaced.
#
# This cluster belongs to the current user, needs no sudo, and listens on a
# non-default port so it cannot collide with a system PostgreSQL on 5432.
#
# Usage:
#   scripts/start-local-postgres.sh [start|stop|status]

set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/18/bin}"
PGDATA="${PGDATA:-$HOME/.local/share/travel-crm-postgres}"
PGPORT="${PGPORT:-55432}"
# Kept short: a Unix socket path over 107 bytes is rejected by the kernel.
PGSOCKET="${PGSOCKET:-/tmp/crmpg}"
PGUSER_NAME="${PGUSER_NAME:-crm}"
PGDATABASE_NAME="${PGDATABASE_NAME:-travel_crm}"

if [[ ! -x "$PG_BIN/pg_ctl" ]]; then
  echo "PostgreSQL binaries not found at $PG_BIN. Set PG_BIN." >&2
  exit 1
fi

case "${1:-start}" in
  start)
    mkdir -p "$PGSOCKET"

    if [[ ! -d "$PGDATA/base" ]]; then
      echo "==> Initialising a new cluster at $PGDATA"
      # trust auth is acceptable here: the cluster listens on loopback only and
      # is owned by this user. Production uses real credentials.
      "$PG_BIN/initdb" -D "$PGDATA" -U "$PGUSER_NAME" --auth=trust >/dev/null
    fi

    if "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
      echo "Already running on port $PGPORT."
    else
      "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" \
        -o "-p $PGPORT -k $PGSOCKET -c listen_addresses=127.0.0.1" start
      sleep 2
    fi

    if ! psql -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER_NAME" -lqt 2>/dev/null \
         | cut -d'|' -f1 | grep -qw "$PGDATABASE_NAME"; then
      "$PG_BIN/createdb" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER_NAME" "$PGDATABASE_NAME"
      echo "==> Created database $PGDATABASE_NAME"
    fi

    echo
    echo "Ready. Put this in .env:"
    echo "  DATABASE_URL=\"postgresql://$PGUSER_NAME@127.0.0.1:$PGPORT/$PGDATABASE_NAME?schema=public\""
    ;;

  stop)
    "$PG_BIN/pg_ctl" -D "$PGDATA" stop
    ;;

  status)
    "$PG_BIN/pg_ctl" -D "$PGDATA" status || true
    ;;

  *)
    echo "usage: $0 [start|stop|status]" >&2
    exit 1
    ;;
esac
