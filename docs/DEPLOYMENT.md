# Deployment

## What has and has not been verified

Everything in this document has been written against a working application, but
the deployment itself has **not been performed** — there is no target
environment. Be clear about which is which:

| Verified here | Not verified |
|---|---|
| Migrations generated for MySQL 8.0 from the schema | Applying them against a running MySQL, and behaviour on a managed service |
| Seed provisions permissions, roles and the first admin | TLS termination and domain routing |
| Backup and restore round-trips, rows and document bytes | Restore under real production volume |
| 239 unit/integration + 22 browser tests pass | Load, concurrency at scale, failover |
| Customer email sends over real SMTP, verified in a browser against a live server | Deliverability: SPF, DKIM, DMARC, and whether a provider accepts your domain |
| Build, typecheck and lint are clean | Monitoring and alert delivery |
| A standalone release boots, serves `/admin/login` with its stylesheet, reaches MySQL through `/api/health`, and emits the security headers — from an 88 MB directory with no build toolchain beside it | `hostinger-setup.sh` and `hostinger-deploy.sh` against a real VPS: they have been syntax-checked and reasoned through, not run on Ubuntu |

Treat the smoke-test checklist at the end as the acceptance gate. Until it has
been run against the real environment, this application is not deployed —
it is only deployable.

## Required configuration

Every value is server-side. Nothing is prefixed `NEXT_PUBLIC_`, so none of it
reaches the browser bundle.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | MySQL connection string, `mysql://user:pass@host:3306/db`. Use the **pooled** one on a serverless host. No default — the application cannot start without it |
| `DIRECT_URL` | serverless | Direct, non-pooled string. Used by the Prisma CLI for migrations and seeding only |
| `AUTH_SECRET` | yes | ≥32 chars. `openssl rand -base64 32` |
| `AUTH_URL` | yes | Canonical origin, e.g. `https://crm.example.com` |
| `NODE_ENV` | yes | `production`. Set for you on Vercel |
| `STORAGE_DRIVER` | yes | `local` for a single host; `blob` on Vercel |
| `STORAGE_LOCAL_ROOT` | if local | Must NOT be under `public/` — the env schema rejects it |
| `BLOB_READ_WRITE_TOKEN` | if blob | Injected by Vercel when a Blob store is linked. Startup fails without it |
| `SESSION_MAX_AGE_SECONDS` | no | Default 28800 (8 hours) |
| `LOGIN_MAX_ATTEMPTS` | no | Default 5 |
| `LOGIN_LOCKOUT_SECONDS` | no | Default 900 |
| `LOG_LEVEL` | no | `info` in production |
| `BUSINESS_TIMEZONE` | no | Drives report date bucketing |
| `MAIL_DRIVER` | no | `none` (default) records what was owed and sends nothing; `smtp` sends |
| `SMTP_HOST` | if smtp | Env schema refuses to start without it when the driver is `smtp` |
| `SMTP_PORT` | no | Default 587 (STARTTLS). Use 465 with `SMTP_SECURE="true"` |
| `SMTP_SECURE` | no | `"true"` for implicit TLS on 465 |
| `SMTP_USER` / `SMTP_PASSWORD` | no | Omit both for a relay that authorises by network |
| `MAIL_FROM` | if smtp | Envelope sender, e.g. `Travel CRM <bookings@example.com>` |
| `MAIL_REPLY_TO` | no | Where customer replies land, if not `MAIL_FROM` |

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
# 1. Provision MySQL 8.0+ and private object storage.
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

- Node.js 20.9+ (22 recommended; developed and tested on 22.22)
- MySQL 8.0+ (or MariaDB 10.6+). The schema uses JSON columns and the
  `utf8mb4_unicode_ci` collation, and the search filters rely on that
  collation being case-insensitive
- `mysqldump` and `mysql` on the host, for `scripts/backup.sh` and
  `scripts/restore.sh`
- A persistent filesystem for `STORAGE_LOCAL_ROOT`, or the `blob` driver
- Outbound network access is **not** required — no integrations are configured

## Deploying to Vercel

The sequence above assumes one long-lived host. Vercel is neither long-lived
nor one host, and three things change as a result.

**The filesystem is not writable.** Everything outside `/tmp` is read-only, and
`/tmp` is not shared between invocations — a document written during an upload
is gone before the request that reads it back. Set `STORAGE_DRIVER="blob"` and
link a Blob store; the local driver will appear to work and silently lose every
upload. `src/lib/storage/blob-adapter.ts` stores objects with `access:
"private"`, so the guarantee that bytes leave only through
`/api/admin/documents/[id]/view` is preserved. There is still no public URL.

**The Prisma Client is generated, not committed.** `src/generated/prisma` is
gitignored, so a clean checkout has no client at all. `postinstall` runs
`prisma generate`; without it the build fails on the first import.

**Connections are per-instance.** Use the provider's pooled string for
`DATABASE_URL` and its direct string for `DIRECT_URL`. Migrations run over
`DIRECT_URL` (`prisma7.config.ts`) because a proxy that multiplexes connections
cannot hold the session state that DDL and metadata locks require. Where the
provider offers only one endpoint, leave `DIRECT_URL` unset.

**`DATABASE_URL` is required.** The application has no no-database mode: it
once embedded a PostgreSQL in its own process, and MySQL has no in-process
equivalent. `vercel-build` fails the build when the variable is missing, rather
than letting a deployment succeed and 500 on every request.

### Sequence

1. **Create a MySQL 8.0+ database.** PlanetScale, Aiven and Railway all have
   a free or low-cost tier. Copy both the pooled and the direct connection
   string, and note whether the provider requires TLS — if so, append
   `?ssl=true`. Use the `mysql://` scheme: that is what the Prisma CLI
   requires, and the application translates it for the driver.

2. **Import the repository** in the Vercel dashboard. The Next.js preset is
   detected automatically; leave the build command alone. `vercel-build` is
   defined in `package.json` and takes precedence — it runs
   `prisma migrate deploy && next build`, so migrations are applied on every
   deployment before the new code goes live.

3. **Add a Blob store** under Storage, and connect it to the project.
   `BLOB_READ_WRITE_TOKEN` is injected automatically.

4. **Set the environment variables** for Production:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | pooled connection string |
   | `DIRECT_URL` | direct connection string |
   | `AUTH_SECRET` | a **new** `openssl rand -base64 32` — never the local one |
   | `AUTH_URL` | `https://<project>.vercel.app` |
   | `STORAGE_DRIVER` | `blob` |
   | `INITIAL_ADMIN_EMAIL` | the first administrator |
   | `INITIAL_ADMIN_NAME` | |
   | `INITIAL_ADMIN_USERNAME` | |

   `NODE_ENV` is set to `production` by Vercel; do not set it by hand. Leave
   `INITIAL_ADMIN_PASSWORD` unset so the seed generates a strong one.

5. **Deploy.** The build applies migrations and compiles.

6. **Seed, once.** The database now has tables but no permissions, no roles and
   no administrator, so sign-in is impossible until this runs. From a checkout
   with `DIRECT_URL` pointed at the production database:

   ```bash
   DIRECT_URL="<direct string>" npm run db:seed
   ```

   **Capture the one-time password from stdout.** It is printed once, stored
   only as a bcrypt digest, and cannot be recovered afterwards — not even by a
   `SUPER_ADMIN`. The account is flagged to change it at first sign-in.

7. **Run the smoke-test checklist below** against the deployed URL.

### What the free plan does and does not give you

Workable: HTTPS and a `*.vercel.app` domain, automatic deploys on push, 7 days
of logs, and a Blob store.

Worth knowing before you rely on it:

- **Function duration is capped**, and lower on Hobby than on Pro. The report
  pages issue seven or more aggregate queries in parallel; on a large dataset
  they are the first thing to time out.
- **Instances sleep.** The first request after idle pays a cold start plus a
  fresh database connection.
- **No scheduled jobs worth the name.** `scripts/backup.sh` is not run for you.
  Database backups become the MySQL provider's responsibility — check what
  the free tier actually retains, because for most it is days, not months.
- **Hobby is for non-commercial use.** Running a real agency's bookings on it
  is outside Vercel's terms; that needs a Pro plan.

### Migrating existing documents

Switching an existing deployment from `local` to `blob` does **not** move the
files already on disk. Their database rows keep pointing at keys the blob store
has never heard of, and `/api/admin/documents/[id]/view` will answer 404. On a
fresh database this is moot. On a populated one, upload each object under its
existing key before switching the driver — the key is the stored value and must
round-trip unchanged.

### HTTPS

Terminate TLS at the load balancer or reverse proxy. The application sets
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
`Permissions-Policy` itself (`next.config.ts`). **Add HSTS at the terminator**,
not in the application, so local HTTP development is unaffected.

Session cookies are `secure` whenever `NODE_ENV=production`, so the application
must be served over HTTPS or sign-in will not work.

## Deploying to a Hostinger VPS

This is the "one long-lived host" the deployment sequence above assumes, and
the repository carries the pieces for it:

| File | What it is |
|---|---|
| `scripts/hostinger-setup.sh` | First run. Creates the release layout, installs the systemd unit and the nginx site, then stops and lists what is left for you |
| `scripts/hostinger-deploy.sh` | Every release after that. Backup → build → migrate → switch → restart → health-check, with automatic rollback |
| `deploy/travel-crm.service` | systemd unit, hardened, bound to loopback |
| `deploy/nginx.conf` | Reverse proxy, 25 MB upload ceiling, asset caching |
| `deploy/env.production.example` | Annotated template for `shared/.env` |

**Only a VPS plan works.** Hostinger's Web Hosting and Cloud Hosting tiers are
PHP/LiteSpeed environments: they cannot hold a long-lived Node process, bind a
port, or give the SSH access `scripts/backup.sh` needs for `mysqldump`. Among
the VPS plans, KVM 2 (2 vCPU / 8 GB) is the comfortable floor — the peak load
is `next build`, not serving traffic. KVM 1 (1 vCPU / 4 GB) does work: the
deploy script caps the build heap at 1536 MB precisely so V8 collects instead
of growing into swap and stalling. Expect the build to take several minutes
there.

### What a release looks like

```
/srv/travel-crm/
├── repo/                  the git checkout — this is where the build happens
├── shared/
│   ├── .env               secrets, chmod 600, survives every release
│   └── storage/           uploaded documents, survives every release
├── releases/
│   ├── 20261026T084500Z/  a standalone bundle, ~90 MB
│   └── 20261026T142200Z/
└── current -> releases/20261026T142200Z
```

`current` is a symlink, and switching it is an atomic rename, so no request
ever sees a half-replaced directory. The five most recent releases are kept;
rolling back by hand is repointing the symlink and restarting.

Everything that must outlive a release lives in `shared/`. A release directory
is replaced wholesale, so a document or a secret kept inside one is gone at the
next deploy.

### Why the running host carries no build toolchain

`next.config.ts` sets `output: "standalone"`. The build traces what the server
actually imports and writes that, with a pruned `node_modules`, to
`.next/standalone`. The numbers from this repository:

| | Size |
|---|---|
| `node_modules` in the checkout | 1.2 GB |
| A standalone release | 88 MB |

The Prisma driver-adapter setup is part of why that number is small. A classic
Prisma client ships a native query engine per platform; `@prisma/adapter-mariadb`
has none, so the release is JavaScript and the `mariadb` connector.

This also means a release can be built on your laptop and shipped as a tarball,
which is the answer if the VPS is too small to build comfortably. Ship the
release directory, the `shared/.env`, and nothing else.

### 1. Provision and harden

Create the VPS with **Ubuntu 24.04 LTS**, then over SSH as root:

```bash
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # keep key access

ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

Only 22, 80 and 443 are ever exposed. MySQL stays on localhost, and the Node
process binds `127.0.0.1:3000` — nginx is the only thing that can reach it.

### 2. Install the runtime

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs mysql-server nginx git curl certbot python3-certbot-nginx
sudo mysql_secure_installation
```

`mysql-server` brings `mysqldump` and `mysql`, which the backup and restore
scripts shell out to. `hostinger-setup.sh` refuses to continue without them —
a deployment that has no backups should fail loudly on day one, not be
discovered on the day it matters.

### 3. Check out and run setup

```bash
sudo mkdir -p /srv/travel-crm && sudo chown deploy:deploy /srv/travel-crm
git clone <your-repo> /srv/travel-crm/repo
cd /srv/travel-crm/repo
scripts/hostinger-setup.sh crm.example.com
```

It creates the layout, copies the env template to `shared/.env` with mode 600,
installs the systemd unit and the nginx site with your domain substituted in,
and grants `deploy` permission to restart that one service and nothing else.
It is idempotent: an existing file is reported and left alone, never
overwritten.

It deliberately does not install packages, create the database, write secrets
or request a certificate — it prints those as numbered steps instead. Follow
them.

### 4. Create the database

The collation is not optional. The schema uses `utf8mb4_unicode_ci` and the
search filters rely on it being case-insensitive — create it with the wrong one
and `q=` searches silently stop matching on case.

```sql
CREATE DATABASE travel_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'travel_crm'@'localhost' IDENTIFIED BY '<strong-password>';
GRANT ALL PRIVILEGES ON travel_crm.* TO 'travel_crm'@'localhost';
FLUSH PRIVILEGES;
```

### 5. Fill in the environment

Edit `/srv/travel-crm/shared/.env`. Three values have no default and no
sensible guess:

```bash
DATABASE_URL="mysql://travel_crm:<password>@127.0.0.1:3306/travel_crm"
AUTH_SECRET="<openssl rand -base64 32 — a new one, never the local value>"
AUTH_URL="https://crm.example.com"
```

Leave `DIRECT_URL` unset: it exists for serverless hosts whose pooler cannot
hold the session state DDL requires, and here the one string is already direct.
`STORAGE_DRIVER="local"` is correct — `blob` exists for Vercel, where a
writable filesystem does not.

**`AUTH_URL` is read at build time as well as at runtime.** `next.config.ts`
puts its host in the Server Action allow-list, and `output: "standalone"`
freezes that into the bundle. A release built with the wrong one boots cleanly
and then rejects every form submission, which presents as "saving does
nothing". `hostinger-deploy.sh` refuses to build without it.

### 6. Certificate

Point an A record at the VPS IP, wait for it to resolve, then:

```bash
sudo certbot --nginx -d crm.example.com
```

certbot rewrites the nginx site in place, adding the 443 block and the
HTTP→HTTPS redirect. Add HSTS to the block it creates — at the terminator, not
in `next.config.ts`, so local HTTP development is unaffected:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

**HTTPS is not optional.** Session cookies carry `secure` whenever
`NODE_ENV=production`, so over plain HTTP the cookie is set and never sent
back: sign-in appears to succeed and every subsequent request is anonymous.

### 7. First deploy and seed

```bash
cd /srv/travel-crm/repo
SKIP_BACKUP=1 scripts/hostinger-deploy.sh    # nothing to back up yet
npm run db:seed                              # capture the printed password
sudo systemctl enable travel-crm             # start at boot
```

The seed is where the first `SUPER_ADMIN` comes from, and it runs once. The
database has tables but no permissions, no roles and no administrator until it
does, so sign-in is impossible beforehand. **Capture the one-time password from
stdout** — it is printed once, stored only as a bcrypt digest, and is not
recoverable afterwards. The account is flagged to change it at first sign-in.

### 8. Verify

```bash
BASE_URL=https://crm.example.com npm run smoke
```

31 checks, non-zero exit on any failure. This is the acceptance gate — until it
has passed against the real URL, the application is deployable rather than
deployed.

### 9. Backups

Nothing schedules them for you. As `deploy`:

```cron
20 2 * * * cd /srv/travel-crm/repo && scripts/backup.sh /var/backups/travel-crm >> /var/log/travel-crm-backup.log 2>&1
```

Then copy the archives off the host. Hostinger's VPS snapshots are a separate
thing and restore the whole machine, not one database — and a backup living
only on the machine that failed is not a backup.

### Redeploying

```bash
cd /srv/travel-crm/repo && scripts/hostinger-deploy.sh
```

In order: back up (and stop if that fails), `git pull --ff-only`, `npm ci`,
build, assemble a new release, `prisma migrate deploy`, switch the symlink,
restart, then poll `/api/health` for up to 30 seconds.

If health never comes back, the symlink goes to the previous release and the
service is restarted on it. The downtime from a release that compiles but
cannot boot is therefore a few seconds, not an evening.

**The rollback does not undo the migration.** Prisma migrations here are
forward-only, so the previous code would then be running against a newer
schema. That is why the backup comes first and why a failed deploy says so on
the way out: a schema rollback is a restore.

### Hostinger-specific gotchas

- **Outbound SMTP is blocked by default** on new VPS instances — port 25
  always, and often 465/587 until you open a support ticket. Irrelevant while
  `MAIL_DRIVER` is `none`. Use a provider (SES, SendGrid, Postmark, Mailgun)
  over 587 rather than sending direct: deliverability from a fresh VPS IP is
  poor regardless of the port.
- **The default nginx site answers first.** `hostinger-setup.sh` removes
  `/etc/nginx/sites-enabled/default`; if you configure nginx by hand, do the
  same or the placeholder page wins the match for a bare IP.
- **`prisma migrate dev` will fail** against a user without database-creation
  rights — it needs a shadow database. `migrate deploy` does not, and is what
  the deploy script uses. Grant the right only if you intend to author
  migrations on the server, which you should not.
- **Upload size is set in three places and they must agree**: 25 MB in
  `document-service.ts`, `serverActions.bodySizeLimit` in `next.config.ts`, and
  `client_max_body_size` in the nginx site. nginx's own 1 MB default rejects
  the request a layer before the application, with a 413 the form cannot
  explain.
- **hPanel's browser terminal is a root shell.** Use it to create `deploy`,
  then work over SSH as that user.
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
  'mysql://user:pass@host:3306/travel_crm' /srv/travel-crm/storage
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

**Customer email**
- [ ] `npm run smoke` reports "Mail transport is reachable"
- [ ] Confirming a test booking produces a `SENT` notification carrying a
      provider message id, and the message arrives
- [ ] The arriving message contains no passport number and no supplier cost

**Operations**
- [ ] `scripts/backup.sh` completes and writes a manifest
- [ ] Logs are arriving at the log platform
- [ ] A deliberate 404 and a deliberate 403 both render the styled pages

## Things this deployment does not do

Stated plainly so nobody assumes otherwise:

- **No payment provider.** Every payment is an operator record.
- **No refund provider.** A completed refund records that someone did it
  elsewhere.
- **Customer email sends only when SMTP is configured.** With
  `MAIL_DRIVER="none"` — the default — a booking confirmation and a ticketed
  notice are recorded as `SUPPRESSED` and nothing is transmitted. Set
  `MAIL_DRIVER="smtp"` to send for real.
- **No SMS.** Internal messaging between administrators stays inside the CRM.
- **Email deliverability is not configured here.** Sending through a provider
  is not the same as arriving: SPF, DKIM and DMARC for the sending domain are
  a DNS task, and without them a confirmation is likely to be filed as spam.
- **No telephony.** Calls are logged by hand, and no recordings exist.
- **No airline or GDS connection.** PNR text is stored exactly as pasted and is
  never decoded.
- **No chargeback submission.** Cases are prepared and tracked; filing with a
  processor is manual.

Each of these needs its own integration, and — for telephony and messaging — a
consent and compliance review before being enabled.
