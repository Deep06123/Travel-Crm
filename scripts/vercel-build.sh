#!/usr/bin/env bash
#
# Vercel build entry point.
#
# Vercel runs `vercel-build` in preference to `build` when it exists. Both a
# production deployment and every preview deployment go through here, which is
# the reason this is a script rather than a one-line chain of commands.
#
# Environment variables added in the Vercel dashboard apply to all three
# environments unless you narrow them, so a preview build of a feature branch
# normally sees the *production* DATABASE_URL. Running `prisma migrate deploy`
# unconditionally would then apply unreviewed migrations from that branch to
# live customer data, during a build nobody was watching.
#
# So migrations run only for a production deployment. A preview wanting its own
# schema needs its own database and a deliberate `npm run db:deploy` against it;
# a preview left pointing at an older schema fails visibly, which is the better
# of the two failures.

set -euo pipefail

# Generated, never committed: src/generated/prisma is gitignored, so a clean
# checkout has no Prisma Client and every import of it fails.
#
# `postinstall` normally covers this, but it cannot be relied on alone. Recent
# npm releases block package install scripts unless they are approved, and a
# build host that skips ours would fail with dozens of module-not-found errors
# pointing at a folder nobody deleted. Generating here as well is idempotent and
# takes under a second, and it needs no database connection.
echo "▸ Generating Prisma Client"
npx prisma generate

# Vercel exposes configured variables to the build environment directly. Locally
# they live in .env, which Next reads but the shell does not — so rehearsing this
# script on a machine with a database would otherwise take the "no database"
# branch and report something untrue about what it had just done.
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${DATABASE_URL:-}${DIRECT_URL:-}" ]; then
  # There is no longer a fallback to fall back to: MySQL has no in-process
  # equivalent of the embedded PostgreSQL this project used to run without a
  # connection string, so a deployment with no DATABASE_URL cannot serve a
  # single page. Failing the build says so now, rather than letting the deploy
  # succeed and every request 500.
  echo "✗ DATABASE_URL is not set." >&2
  echo "  This application requires a MySQL database. Add DATABASE_URL to the" >&2
  echo "  project's environment variables, as mysql://user:pass@host:3306/db" >&2
  exit 1
elif [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "▸ Production deployment — applying migrations"
  npx prisma migrate deploy
elif [ -z "${VERCEL_ENV:-}" ]; then
  # Not running on Vercel at all: a local rehearsal of the deployment build.
  echo "▸ VERCEL_ENV is unset — skipping migrations (local build)"
else
  echo "▸ ${VERCEL_ENV} deployment — skipping migrations"
  echo "  Migrations are applied on production deployments only, so that a"
  echo "  preview branch cannot alter the production schema. Run"
  echo "  'npm run db:deploy' against this environment's own database if it"
  echo "  needs a newer schema."
fi

echo "▸ Building"
exec npx next build
