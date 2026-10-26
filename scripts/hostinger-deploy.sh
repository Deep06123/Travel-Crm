#!/usr/bin/env bash
#
# Release the Travel Booking CRM onto a Hostinger VPS.
#
# Run as the `deploy` user, from the git checkout:
#
#   cd /srv/travel-crm/repo && scripts/hostinger-deploy.sh
#
# What it does, in order: back up, fetch, build a standalone release beside the
# live one, apply migrations, switch a symlink, restart, and prove the new
# process answers. If it does not answer, the symlink goes back to the previous
# release and the service is restarted on that — so a build that compiles but
# cannot boot costs seconds of downtime rather than an evening.
#
# What it deliberately does NOT do is undo a migration. Prisma migrations here
# are forward-only: a schema rollback is a restore from the backup this script
# takes first. That is why the backup is not optional and why the script stops
# if it fails.
#
# Layout it expects (scripts/hostinger-setup.sh creates it):
#
#   /srv/travel-crm/repo             this checkout, where the build happens
#   /srv/travel-crm/shared/.env      secrets, chmod 600, survives releases
#   /srv/travel-crm/shared/storage   uploaded documents, survives releases
#   /srv/travel-crm/releases/<utc>   one directory per release
#   /srv/travel-crm/current          symlink to the live release
#
# Environment overrides: ROOT, KEEP_RELEASES, SERVICE, HEALTH_URL, BACKUP_DIR,
# SKIP_BACKUP=1 (first deploy, when there is no database to back up yet).

set -euo pipefail

ROOT="${ROOT:-/srv/travel-crm}"
SHARED="$ROOT/shared"
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
SERVICE="${SERVICE:-travel-crm}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/travel-crm}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Preflight. Each of these failures is cheap to discover now and expensive to
# discover halfway through a release.
# ---------------------------------------------------------------------------

[ -f "$SHARED/.env" ] || fail "$SHARED/.env not found. Copy deploy/env.production.example there first."

# The build needs the configuration too, not just the running process:
# next.config.ts reads AUTH_URL to build the Server Action allow-list, and
# `output: "standalone"` freezes the result into the bundle.
set -a
# shellcheck disable=SC1091
. "$SHARED/.env"
set +a

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set in $SHARED/.env"
[ -n "${AUTH_SECRET:-}" ] || fail "AUTH_SECRET is not set in $SHARED/.env"
[ -n "${AUTH_URL:-}" ] || fail "AUTH_URL is not set in $SHARED/.env — it is baked into the build, not read at startup."

# A release built against the wrong origin boots fine and then rejects every
# Server Action, which reads as "saving does nothing" rather than as a
# misconfiguration. Worth one line to catch.
case "$AUTH_URL" in
  https://*) ;;
  *) fail "AUTH_URL must be https:// in production — session cookies are 'secure' and will not be sent back over HTTP." ;;
esac

mkdir -p "$RELEASES" "$SHARED/storage"

PREVIOUS=""
if [ -L "$CURRENT" ]; then
  PREVIOUS="$(readlink -f "$CURRENT")"
fi

# ---------------------------------------------------------------------------
# 1. Back up before anything is allowed to change.
# ---------------------------------------------------------------------------

if [ "${SKIP_BACKUP:-}" = "1" ]; then
  step "Skipping backup (SKIP_BACKUP=1)"
else
  step "Backing up to $BACKUP_DIR"
  scripts/backup.sh "$BACKUP_DIR" || fail "Backup failed. Nothing has been changed — fix the backup before deploying."
fi

# ---------------------------------------------------------------------------
# 2. Fetch and install.
# ---------------------------------------------------------------------------

step "Fetching"
git pull --ff-only

step "Installing dependencies"
# `npm ci` and not `npm install`: the lockfile is the record of what was
# tested. Dev dependencies are needed — the build runs tsc, Tailwind and the
# Prisma CLI — but none of them are traced into the standalone output, so the
# weight stays in the repo directory and off the live release.
npm ci

# ---------------------------------------------------------------------------
# 3. Build.
# ---------------------------------------------------------------------------

step "Building"
# 2 GB is the smallest Hostinger plan worth using and `next build` is the peak
# of the whole deployment — well above serving traffic. Capping the heap makes
# V8 collect rather than grow into swap and stall; without it, a KVM 1 box
# tends to be OOM-killed mid-build with no message.
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}" npm run build

# ---------------------------------------------------------------------------
# 4. Assemble the release.
#
# `output: "standalone"` traces what the server actually imports and writes it,
# with a pruned node_modules, to .next/standalone. Two things it deliberately
# leaves behind, because they are served rather than imported, so nothing in
# the trace points at them:
# ---------------------------------------------------------------------------

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE="$RELEASES/$STAMP"

step "Assembling release $STAMP"
rm -rf "$RELEASE"
mkdir -p "$RELEASE"

[ -f .next/standalone/server.js ] || fail "No .next/standalone/server.js — is output: \"standalone\" still set in next.config.ts?"

cp -a .next/standalone/. "$RELEASE/"
cp -a .next/static "$RELEASE/.next/static"
[ -d public ] && cp -a public "$RELEASE/public"

# Next copies any .env files it finds in the project root into the standalone
# output. Here that would write a second, older copy of the secrets into every
# release directory — one that systemd does not manage, nobody rotates, and a
# pruned-release listing quietly preserves. The EnvironmentFile in shared/ is
# the single source; remove the duplicates.
find "$RELEASE" -maxdepth 1 -name '.env*' -delete

# Next writes its runtime cache here, and systemd's ProtectSystem=strict makes
# everything else read-only. Creating it now means the first request does not
# meet a read-only filesystem.
mkdir -p "$RELEASE/.next/cache"

# ---------------------------------------------------------------------------
# 5. Migrate.
#
# From the repo, where the Prisma CLI and prisma/migrations live — neither is
# part of the standalone output, and neither should be: a release that can
# alter its own schema is a release that can alter it by accident.
#
# `migrate deploy`, never `migrate dev`. dev wants a shadow database, and on a
# drift it offers to reset — which on this database means deleting every
# booking.
# ---------------------------------------------------------------------------

step "Applying migrations"
npx prisma migrate deploy || fail "Migration failed. The previous release is still live and untouched."

# ---------------------------------------------------------------------------
# 6. Switch and restart.
# ---------------------------------------------------------------------------

step "Switching to $STAMP"
# Symlink swap via rename: atomic, so no request ever sees a half-switched
# path. `ln -sfn` alone would nest the new link inside the existing directory.
ln -sfn "$RELEASE" "$CURRENT.tmp"
mv -Tf "$CURRENT.tmp" "$CURRENT"

sudo systemctl restart "$SERVICE"

# ---------------------------------------------------------------------------
# 7. Prove it answers — and go back if it does not.
#
# /api/health runs SELECT 1, so a 200 means this process started, read its
# configuration and reached MySQL. A unit that is "active" proves only that
# node has not exited yet.
# ---------------------------------------------------------------------------

step "Waiting for $HEALTH_URL"
healthy=""
for attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 5 "$HEALTH_URL" > /dev/null; then
    healthy="yes"
    printf '  healthy after %ss\n' "$attempt"
    break
  fi
  sleep 1
done

if [ -z "$healthy" ]; then
  printf '\033[31m✗ New release did not become healthy within 30s\033[0m\n' >&2

  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    printf '  Rolling back to %s\n' "$(basename "$PREVIOUS")" >&2
    ln -sfn "$PREVIOUS" "$CURRENT.tmp"
    mv -Tf "$CURRENT.tmp" "$CURRENT"
    sudo systemctl restart "$SERVICE"
    printf '  Rolled back. The schema was NOT rolled back — if this release\n' >&2
    printf '  migrated, the previous code is now running against a newer\n' >&2
    printf '  schema. Check it, or restore the backup taken above.\n' >&2
  else
    printf '  No previous release to roll back to.\n' >&2
  fi

  printf '  journalctl -u %s -n 50 --no-pager\n' "$SERVICE" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 8. Prune.
# ---------------------------------------------------------------------------

step "Pruning old releases (keeping $KEEP_RELEASES)"
# shellcheck disable=SC2012
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n "+$((KEEP_RELEASES + 1))" | while read -r old; do
  # Never delete what `current` points at, however old the timestamp looks.
  [ "$(readlink -f "$old")" = "$(readlink -f "$CURRENT")" ] && continue
  printf '  removing %s\n' "$(basename "$old")"
  rm -rf "$old"
done

printf '\n\033[32m✓ Deployed %s\033[0m\n' "$STAMP"
printf '  Verify: BASE_URL=%s npm run smoke\n' "$AUTH_URL"
