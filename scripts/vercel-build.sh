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

if [ "${VERCEL_ENV:-}" = "production" ]; then
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
