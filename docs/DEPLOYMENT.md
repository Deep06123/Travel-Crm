# Deployment

## What has and has not been verified

Everything in this document has been written against a working application, but
the deployment itself has **not been performed** — there is no target
environment. Be clear about which is which:

| Verified here | Not verified |
|---|---|
| Migrations apply to an empty PostgreSQL 18 | Behaviour on a managed Postgres service |
| Seed provisions permissions, roles and the first admin | TLS termination and domain routing |
| Backup and restore round-trips, rows and document bytes | Restore under real production volume |
| 228 unit/integration + 22 browser tests pass | Load, concurrency at scale, failover |
| Build, typecheck and lint are clean | Monitoring and alert delivery |

Treat the smoke-test checklist at the end as the acceptance gate. Until it has
been run against the real environment, this application is not deployed —
it is only deployable.

## Required configuration

Every value is server-side. Nothing is prefixed `NEXT_PUBLIC_`, so none of it
reaches the browser bundle.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | ≥32 chars. `openssl rand -base64 32` |
| `AUTH_URL` | yes | Canonical origin, e.g. `https://crm.example.com` |
| `NODE_ENV` | yes | `production` |
| `STORAGE_DRIVER` | yes | `local` today; `s3` once an adapter exists |
| `STORAGE_LOCAL_ROOT` | if local | Must NOT be under `public/` — the env schema rejects it |
| `SESSION_MAX_AGE_SECONDS` | no | Default 28800 (8 hours) |
| `LOGIN_MAX_ATTEMPTS` | no | Default 5 |
| `LOGIN_LOCKOUT_SECONDS` | no | Default 900 |
| `LOG_LEVEL` | no | `info` in production |
| `BUSINESS_TIMEZONE` | no | Drives report date bucketing |

First-run only, used by the seed and then removable:

| Variable | Notes |
|---|---|
| `INITIAL_ADMIN_EMAIL` | Creates the first `SUPER_ADMIN`, only if none exists |
| `INITIAL_ADMIN_NAME` | |
| `INITIAL_ADMIN_USERNAME` | |
| `INITIAL_ADMIN_PASSWORD` | **Leave unset.** A strong password is generated and printed once |

`src/lib/env.ts` validates all of this at startup and fails with a readable
summary of every missing or malformed variable, rather than at first use.

### Secrets

Keep them in the platform's secret store, not in a file in the repository.
`.env` is gitignored; `.env.example` is the committed template and holds no
real values. Rotating `AUTH_SECRET` invalidates nothing on its own — sessions
are database-backed — but rotating database credentials requires a redeploy.

## Deployment sequence

```bash
# 1. Provision PostgreSQL and private object storage.
#    The storage root must not be web-served.

# 2. Set the environment variables above.

# 3. Install and build.
npm ci
npm run build

# 4. Apply migrations. Use deploy, never `migrate dev`, which can reset data.
npm run db:deploy

# 5. Seed reference data and the first administrator.
#    Capture the one-time password from stdout — it is not recoverable.
npm run db:seed

# 6. Start.
npm run start
```

Steps 4 and 5 are idempotent: migrations already applied are skipped, and the
seed will not create a second administrator or reset an existing password.

### Runtime requirements

- Node.js 20.19+ (22 recommended; developed and tested on 22.22)
- A persistent filesystem for `STORAGE_LOCAL_ROOT`, or an S3 adapter
- Outbound network access is **not** required — no integrations are configured

### HTTPS

Terminate TLS at the load balancer or reverse proxy. The application sets
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
`Permissions-Policy` itself (`next.config.ts`). **Add HSTS at the terminator**,
not in the application, so local HTTP development is unaffected.

Session cookies are `secure` whenever `NODE_ENV=production`, so the application
must be served over HTTPS or sign-in will not work.

## Backups

```bash
scripts/backup.sh /var/backups/travel-crm
```

Captures the database and the document store together. A database-only backup
restores to a system whose every document link is broken, so both are always
taken in one archive, with a manifest of row counts and SHA-256 checksums.

Schedule daily and retain 30 days (`BACKUP_RETAIN_DAYS`). Store copies off the
application host — a backup on the machine that failed is not a backup.

### Restoring

```bash
scripts/restore.sh /var/backups/travel-crm/20261018T213746Z \
  'postgresql://user:pass@host:5432/travel_crm' /srv/travel-crm/storage
```

The script verifies checksums, refuses to restore over a populated database,
and compares restored row counts against the manifest. It exits non-zero on a
mismatch rather than reporting success.

**Rehearse this quarterly against a scratch database.** An untested backup is a
hypothesis. This cycle has been exercised locally — database rows and document
bytes both verified — but never at production volume.

### Rollback

1. Put the application into maintenance (stop the process or drain the LB).
2. Deploy the previous build artefact.
3. If the release included a migration that must be undone, restore from the
   backup taken immediately before the deploy. **There is no down-migration
   path**: Prisma migrations here are forward-only, so a schema rollback is a
   restore.
4. Run the smoke-test checklist before returning traffic.

Because of point 3, take a backup immediately before every deploy that includes
a migration.

## Monitoring

The application writes structured JSON to stdout via Pino, with passwords,
passport numbers, card fields, cookies and authorization headers redacted at
the logger. Ship stdout to the log platform.

Worth alerting on:

| Signal | Why |
|---|---|
| `level=error` with `module=auth-service` | Sign-in failures spiking suggests credential stuffing |
| `LoginEvent` rows of type `LOCKED_OUT` | Same, and visible in the UI under each agent |
| `module=document-view` errors | Metadata exists but the stored object is missing |
| `isDatabaseUnavailable` paths | The application degrades rather than crashing, so an outage is otherwise quiet |
| HTTP 5xx rate | Baseline is zero |
| Backup job exit code | A silent backup failure is discovered at the worst moment |

## Production smoke-test checklist

Run after every deploy. Each line is pass/fail, not a judgement call.

The checklist is executable:

```bash
BASE_URL=https://crm.example.com DATABASE_URL=<connection-string> npm run smoke
```

It exits non-zero on any failure, so it can gate a deploy. Checks that need to
arrange a precondition — a role lacking a permission, a passport number to look
for — require `DATABASE_URL`; without it they report SKIPPED and the rest still
run. Every fixture it creates is removed afterwards, verified by re-running and
confirming no residue.

Last run: **31 of 31 passed** against the local stack (see the caveat at the top
of this document — local is not production).

**Access**
- [ ] `https://<host>/` redirects to `/admin/login`
- [ ] `/admin` while signed out redirects to `/admin/login`
- [ ] Sign in with the seeded administrator succeeds
- [ ] First sign-in forces a password change
- [ ] Sign out returns to the login page, and `/admin` redirects again
- [ ] A wrong password and an unknown address give the **same** message

**Data**
- [ ] Dashboard renders and its figures are non-placeholder
- [ ] Booking list loads, filters apply, pagination works
- [ ] Opening a booking shows itinerary, passengers, ticketing and accounting
- [ ] Creating a customer succeeds; a duplicate email is flagged

**Money**
- [ ] Recording a payment updates the booking position
- [ ] A manually recorded payment is labelled "Manually recorded"
- [ ] A refund cannot be approved by the person who requested it
- [ ] Gross booking value and payments collected differ where expected

**Documents**
- [ ] Uploading a PDF succeeds
- [ ] Viewing it returns the file for an authorised role
- [ ] Fetching the same URL signed out returns 401
- [ ] The storage path is not reachable directly over HTTP

**Permissions**
- [ ] A `READ_ONLY` account cannot see the booking status control
- [ ] A `SUPPORT` account gets 403 from `/api/admin/bookings/export`
- [ ] Passport numbers are absent from the HTML for roles without
      `passenger.viewSensitive`

**Operations**
- [ ] `scripts/backup.sh` completes and writes a manifest
- [ ] Logs are arriving at the log platform
- [ ] A deliberate 404 and a deliberate 403 both render the styled pages

## Things this deployment does not do

Stated plainly so nobody assumes otherwise:

- **No payment provider.** Every payment is an operator record.
- **No refund provider.** A completed refund records that someone did it
  elsewhere.
- **No email or SMS.** Messaging is internal to the CRM; the notification table
  stays empty until an integration populates it.
- **No telephony.** Calls are logged by hand, and no recordings exist.
- **No airline or GDS connection.** PNR text is stored exactly as pasted and is
  never decoded.
- **No chargeback submission.** Cases are prepared and tracked; filing with a
  processor is manual.

Each of these needs its own integration, and — for telephony and messaging — a
consent and compliance review before being enabled.
