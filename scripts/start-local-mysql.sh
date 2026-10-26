#!/usr/bin/env bash
#
# Runs the development database.
#
# Like the PostgreSQL cluster this project used before MySQL, the server
# belongs to the current user and needs no sudo at any point: a data directory
# it owns, a non-default port so it cannot collide with a system MySQL on 3306,
# and the distribution's own system service left entirely alone.
#
# The data directory lives under /var/tmp rather than $HOME. That is not a
# preference. A packaged server cannot write to a home directory — it aborts
# with "Permission denied" on a path that looks perfectly writable, because the
# sandbox profile shipped with the package does not include $HOME. /var/tmp is
# permitted, and unlike /tmp it survives a reboot.
#
# Falls back to a container when no server binary is installed, so this also
# works on a machine with Docker and nothing else.
#
# Usage:
#   scripts/start-local-mysql.sh [start|stop|status|ensure|setup|reset]
#
#   ensure  called by `npm run dev`; starts the server quietly
#   setup   create the database and user on a server this script does NOT run,
#           such as a system service — the one command that may need sudo
#
# Environment:
#   MYSQL_PORT       port to listen on, defaults to 53306
#   MYSQL_DATADIR    data directory, defaults to /var/tmp/travel-crm-mysql
#   MYSQL_ADMIN_URL  admin connection used by `setup`, e.g.
#                    mysql://root:secret@127.0.0.1:3306 — omit to use
#                    `sudo mysql`, which is how a packaged server
#                    authenticates root

set -euo pipefail

cd "$(dirname "$0")/.."

MYSQL_PORT="${MYSQL_PORT:-53306}"
MYSQL_DATADIR="${MYSQL_DATADIR:-/var/tmp/travel-crm-mysql}"
MYSQL_DATABASE="${MYSQL_DATABASE:-travel_crm}"
MYSQL_USER_NAME="${MYSQL_USER_NAME:-crm}"
# A fixed development password. It is in the repository on purpose: the server
# binds to loopback and holds development data. Production credentials come
# from the environment and are never defaulted.
MYSQL_PASSWORD="${MYSQL_PASSWORD:-devpassword}"

# Kept out of the data directory and deliberately short: the kernel rejects a
# Unix socket path longer than 107 bytes.
MYSQL_SOCKET="${MYSQL_SOCKET:-/tmp/crmmysql.sock}"
PID_FILE="$MYSQL_DATADIR/mysqld.pid"
LOG_FILE="$MYSQL_DATADIR/mysqld.log"

RUN_AS="$(id -un)"
CONNECTION_URL="mysql://$MYSQL_USER_NAME:$MYSQL_PASSWORD@127.0.0.1:$MYSQL_PORT/$MYSQL_DATABASE"

# --- What is available on this machine ---------------------------------------

SERVER_BIN=""
for candidate in mariadbd mysqld; do
  if command -v "$candidate" >/dev/null 2>&1; then
    SERVER_BIN="$(command -v "$candidate")"
    break
  fi
  # Server binaries usually live in sbin, which is not on a user's PATH.
  for dir in /usr/sbin /usr/libexec /usr/local/sbin; do
    if [[ -x "$dir/$candidate" ]]; then
      SERVER_BIN="$dir/$candidate"
      break 2
    fi
  done
done

INIT_BIN=""
for candidate in mariadb-install-db mysql_install_db; do
  if command -v "$candidate" >/dev/null 2>&1; then
    INIT_BIN="$candidate"
    break
  fi
done

CLIENT_BIN="$(command -v mariadb || command -v mysql || true)"

DOCKER="${DOCKER:-docker}"
USE_DOCKER=0
if [[ -z "$SERVER_BIN" ]] && command -v "$DOCKER" >/dev/null 2>&1; then
  USE_DOCKER=1
fi

DOCKER_CONTAINER="${MYSQL_CONTAINER:-travel-crm-mysql}"
DOCKER_VOLUME="${MYSQL_VOLUME:-travel-crm-mysql-data}"
DOCKER_IMAGE="${MYSQL_IMAGE:-mysql:8.4}"

# --- Helpers -----------------------------------------------------------------

# True when the application's own credentials reach its own database, which is
# the only definition of "ready" that matters to `npm run dev`.
reachable() {
  [[ -n "$CLIENT_BIN" ]] || return 1
  "$CLIENT_BIN" --protocol=TCP -h 127.0.0.1 -P "$MYSQL_PORT" \
    -u "$MYSQL_USER_NAME" -p"$MYSQL_PASSWORD" -D "$MYSQL_DATABASE" \
    -e "SELECT 1" >/dev/null 2>&1
}

# True when anything answers on the port, whether or not our credentials work.
# Separates "no server" from "server, but no database yet" — two situations
# with completely different fixes.
listening() {
  [[ -n "$CLIENT_BIN" ]] || return 1
  "$CLIENT_BIN" --protocol=TCP -h 127.0.0.1 -P "$MYSQL_PORT" -u root \
    -e "SELECT 1" >/dev/null 2>&1 && return 0

  # An authentication failure still proves a server answered. Captured into a
  # variable rather than piped into grep, because `pipefail` would hand back
  # the client's non-zero exit and report no server at all.
  local output
  output="$("$CLIENT_BIN" --protocol=TCP -h 127.0.0.1 -P "$MYSQL_PORT" -u root </dev/null 2>&1 || true)"
  [[ "$output" == *"Access denied"* ]]
}

server_running() {
  if [[ "$USE_DOCKER" == "1" ]]; then
    [[ "$(docker_state)" == "running" ]]
    return
  fi
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

# Waits for the server to answer as root, which is true as soon as it is up —
# before the database exists, which is the next step rather than this one.
wait_for_server() {
  for _ in $(seq 1 60); do
    listening && return 0
    sleep 1
  done
  echo "MySQL did not become ready within 60s. See $LOG_FILE" >&2
  return 1
}

# Creates the database and the application user. Every statement tolerates
# having run before, so this is safe to repeat on each start.
grant_sql() {
  cat <<SQL
CREATE DATABASE IF NOT EXISTS \`$MYSQL_DATABASE\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- prisma migrate dev builds a throwaway copy of the schema to verify a
-- migration against, and cannot create it without this.
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}_shadow\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$MYSQL_USER_NAME'@'%' IDENTIFIED BY '$MYSQL_PASSWORD';
CREATE USER IF NOT EXISTS '$MYSQL_USER_NAME'@'localhost' IDENTIFIED BY '$MYSQL_PASSWORD';
GRANT ALL PRIVILEGES ON \`$MYSQL_DATABASE\`.* TO '$MYSQL_USER_NAME'@'%';
GRANT ALL PRIVILEGES ON \`$MYSQL_DATABASE\`.* TO '$MYSQL_USER_NAME'@'localhost';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_shadow\`.* TO '$MYSQL_USER_NAME'@'%';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_shadow\`.* TO '$MYSQL_USER_NAME'@'localhost';
FLUSH PRIVILEGES;
SQL
}

apply_grants_as_root() {
  grant_sql | "$CLIENT_BIN" --protocol=TCP -h 127.0.0.1 -P "$MYSQL_PORT" -u root >/dev/null
}

# --- Native server ------------------------------------------------------------

start_native() {
  if [[ ! -d "$MYSQL_DATADIR/mysql" ]]; then
    echo "==> Initialising a new data directory at $MYSQL_DATADIR"
    mkdir -p "$MYSQL_DATADIR"

    # --no-defaults skips /etc/mysql/my.cnf, which a package ships with
    # `user = mysql` and a datadir of /var/lib/mysql — both wrong for a server
    # this user owns. --user names the account to run as, which otherwise
    # defaults to one with no access to the directory just created.
    #
    # Password-less root over loopback is acceptable here: the server binds to
    # 127.0.0.1 and the application still connects as $MYSQL_USER_NAME with a
    # password, exactly as it does in production.
    if [[ -n "$INIT_BIN" ]]; then
      "$INIT_BIN" --no-defaults --user="$RUN_AS" --datadir="$MYSQL_DATADIR" \
        --auth-root-authentication-method=normal --skip-test-db >/dev/null
    else
      "$SERVER_BIN" --no-defaults --user="$RUN_AS" --initialize-insecure \
        --datadir="$MYSQL_DATADIR" >/dev/null 2>&1
    fi
  fi

  if ! server_running; then
    "$SERVER_BIN" \
      --no-defaults \
      --user="$RUN_AS" \
      --datadir="$MYSQL_DATADIR" \
      --socket="$MYSQL_SOCKET" \
      --port="$MYSQL_PORT" \
      --bind-address=127.0.0.1 \
      --pid-file="$PID_FILE" \
      --log-error="$LOG_FILE" \
      >/dev/null 2>&1 &
    disown
  fi

  wait_for_server
  reachable || apply_grants_as_root
}

# --- Container ---------------------------------------------------------------

docker_state() {
  "$DOCKER" inspect --format '{{.State.Status}}' "$DOCKER_CONTAINER" 2>/dev/null || echo absent
}

start_docker() {
  case "$(docker_state)" in
    running) ;;
    absent)
      "$DOCKER" run --detach \
        --name "$DOCKER_CONTAINER" \
        --publish "127.0.0.1:$MYSQL_PORT:3306" \
        --volume "$DOCKER_VOLUME:/var/lib/mysql" \
        --env "MYSQL_ALLOW_EMPTY_PASSWORD=yes" \
        --env "MYSQL_DATABASE=$MYSQL_DATABASE" \
        --env "MYSQL_USER=$MYSQL_USER_NAME" \
        --env "MYSQL_PASSWORD=$MYSQL_PASSWORD" \
        "$DOCKER_IMAGE" >/dev/null
      ;;
    *) "$DOCKER" start "$DOCKER_CONTAINER" >/dev/null ;;
  esac

  wait_for_server
  # The image creates the database and user on first boot only, so a volume
  # predating a change to either name needs this applied again.
  reachable || apply_grants_as_root
}

start_server() {
  if [[ "$USE_DOCKER" == "1" ]]; then
    start_docker
  elif [[ -n "$SERVER_BIN" ]]; then
    start_native
  else
    no_server_advice
    exit 1
  fi
}

no_server_advice() {
  cat >&2 <<EOF
No MySQL server is installed, and there is no $DOCKER to run one in.

Pick whichever suits you:

  sudo apt install mariadb-server     # Debian/Ubuntu
  brew install mariadb                # macOS

This script then runs it as you, on port $MYSQL_PORT, with no further sudo.

Or point .env at a MySQL you already have:
  DATABASE_URL="mysql://user:password@host:3306/$MYSQL_DATABASE"
EOF
}

# --- Commands ----------------------------------------------------------------

case "${1:-start}" in
  # Called by `npm run dev`. Acts only when DATABASE_URL actually points at
  # this port, so aiming .env at another server does not start a second one
  # alongside it. Stays quiet when there is nothing to do; `npm run dev` should
  # not open with a wall of database chatter every time.
  #
  # This exists because `next dev` does not start a database, and forgetting to
  # start one surfaces as a P1001 "Can't reach database server" at the sign-in
  # screen rather than as anything naming the cause.
  ensure)
    if [[ -f .env ]] && ! grep -qE "DATABASE_URL=\"?[^\"]*:$MYSQL_PORT/" .env; then
      echo "DATABASE_URL does not point at port $MYSQL_PORT — leaving the database alone."
      exit 0
    fi

    reachable && exit 0
    echo "==> Starting MySQL on port $MYSQL_PORT"
    start_server
    ;;

  start)
    if reachable; then
      echo "Already running on port $MYSQL_PORT."
    else
      start_server
    fi

    echo "Ready on port $MYSQL_PORT. Put this in .env:"
    echo "  DATABASE_URL=\"$CONNECTION_URL\""
    echo
    echo "Then apply the schema and seed it:"
    echo "  npm run db:deploy && npm run db:seed"
    ;;

  # Creates the database and user on a server this script does NOT run — a
  # system service, say. Needs an account that may CREATE DATABASE and CREATE
  # USER; a packaged server authenticates root by Unix socket rather than by
  # password, which is why the fallback is `sudo mysql`.
  #
  # Not needed for the server this script runs itself: `start` creates them.
  setup)
    if [[ -z "$CLIENT_BIN" ]]; then
      echo "No mysql or mariadb client found to run the setup with." >&2
      exit 1
    fi

    if [[ -n "${MYSQL_ADMIN_URL:-}" ]]; then
      echo "==> Creating \`$MYSQL_DATABASE\` and user '$MYSQL_USER_NAME'"
      grant_sql | "$CLIENT_BIN" "$MYSQL_ADMIN_URL"
    else
      echo "==> Creating \`$MYSQL_DATABASE\` and user '$MYSQL_USER_NAME' (via sudo)"
      grant_sql | sudo "$CLIENT_BIN"
    fi

    echo
    echo "Done. Then apply the schema and seed it:"
    echo "  npm run db:deploy && npm run db:seed"
    ;;

  stop)
    if [[ "$USE_DOCKER" == "1" ]]; then
      "$DOCKER" stop "$DOCKER_CONTAINER" >/dev/null 2>&1 \
        && echo "Stopped. The data volume $DOCKER_VOLUME is kept." \
        || echo "Not running."
    elif server_running; then
      kill "$(cat "$PID_FILE")"
      echo "Stopped. The data directory $MYSQL_DATADIR is kept."
    else
      echo "Not running."
    fi
    ;;

  status)
    if reachable; then
      echo "reachable on port $MYSQL_PORT as '$MYSQL_USER_NAME'"
    elif listening; then
      echo "a server is listening on port $MYSQL_PORT, but \`$MYSQL_DATABASE\` is not set up"
    else
      echo "nothing reachable on port $MYSQL_PORT"
    fi

    if [[ "$USE_DOCKER" == "1" ]]; then
      echo "backend: docker ($DOCKER_IMAGE), volume $DOCKER_VOLUME"
    elif [[ -n "$SERVER_BIN" ]]; then
      echo "backend: $SERVER_BIN"
      echo "datadir: $MYSQL_DATADIR"
    fi
    ;;

  # Discards the data. Separate from `stop` because losing a development
  # database should take saying so.
  reset)
    if [[ "$USE_DOCKER" == "1" ]]; then
      "$DOCKER" rm --force "$DOCKER_CONTAINER" >/dev/null 2>&1 || true
      "$DOCKER" volume rm "$DOCKER_VOLUME" >/dev/null 2>&1 || true
    else
      server_running && kill "$(cat "$PID_FILE")" && sleep 2
      rm -rf "$MYSQL_DATADIR"
    fi
    echo "Removed the local database. Run '$0 start' for a fresh one,"
    echo "then: npm run db:deploy && npm run db:seed"
    ;;

  *)
    echo "usage: $0 [start|stop|status|ensure|setup|reset]" >&2
    exit 1
    ;;
esac
