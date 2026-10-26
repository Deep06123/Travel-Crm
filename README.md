# Travel Booking Admin CRM

Admin-only CRM for flight and cruise booking operations: bookings, customers,
passengers, ticketing, payments, refunds, chargebacks, documents, agents,
suppliers, follow-ups, messaging and reports.

The HTML files and screenshots under `../helping stuff/` are the design and
feature reference. They are prototypes: their layout and business fields are
reproduced here, their implementation is not. Browser-side storage, hard-coded
credentials and plaintext password columns are deliberately **not** carried
over.

## Stack

| Area | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript, strict |
| Styling | Tailwind CSS v4 |
| Database | MySQL 8.0+ |
| ORM | Prisma 7 with the `@prisma/adapter-mariadb` driver adapter |
| Validation | Zod 4 |
| Tables / charts | TanStack Table, Recharts |
| Forms | React Hook Form + Zod |
| Logging | Pino, structured, with field redaction |
| Tests | Vitest (unit, integration), Playwright (end-to-end) |

## Getting started

```bash
npm install
cp .env.example .env     # then fill in DATABASE_URL and AUTH_SECRET
npm run dev:db           # starts a local MySQL in Docker (see below)
npm run db:deploy        # applies migrations
npm run db:seed          # permissions, roles, reference data, first admin
npm run dev
```

### The database must be running

`DATABASE_URL` is required. There is no fallback — the application cannot serve
a page without a MySQL to talk to, and says so at startup rather than failing
per request.

`npm run dev` starts the local MySQL container first, but only when
`DATABASE_URL` points at it (port 53306). If you repoint `DATABASE_URL` at a
system MySQL or any other server, `npm run dev` says so and leaves it alone —
starting that server is then up to you.

The container keeps running after `next dev` exits; `npm run dev:db:stop` shuts
it down and `npm run dev:db:reset` discards its data. The data itself lives in
a named Docker volume and survives both a restart and a reboot.

Running MySQL yourself instead is fine. Create a database and a user, then put
the connection string in `.env`:

```bash
mysql -u root -p -e "CREATE DATABASE travel_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p -e "CREATE USER 'crm'@'%' IDENTIFIED BY 'devpassword';"
mysql -u root -p -e "GRANT ALL PRIVILEGES ON travel_crm.* TO 'crm'@'%';"
```

```
DATABASE_URL="mysql://crm:devpassword@127.0.0.1:3306/travel_crm"
```

Use the `mysql://` scheme even though the driver underneath is mariadb: that is
what the Prisma CLI requires, and the application translates it.

When the database is unreachable the application degrades rather than crashing:
the sign-in page still renders and reports the outage in plain words, and
protected routes redirect to sign-in instead of returning a stack trace.

The seed prints a one-time password for the first administrator when
`INITIAL_ADMIN_PASSWORD` is not set. The account is flagged to change it at
first sign-in.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit and integration tests |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:deploy` | Apply migrations without generating (deployments) |
| `npm run db:seed` | Seed reference data |
| `npm run db:studio` | Prisma Studio |

## Architecture

```
src/
  app/
    admin/
      login/                 sign in — outside the authenticated layout
      change-password/       forced password change — also outside it
      (dashboard)/           route group carrying the authenticated layout
    api/admin/               route handlers
  components/
    layout/                  admin shell, sidebar, navigation definition
    ui/                      buttons, fields, panels, status badges
  features/                  per-feature server actions and client components
  lib/
    auth/                    password hashing, sessions, the access layer
    db/                      Prisma client
    permissions/             permission catalogue and role resolution
    financial/               money arithmetic
    audit/                   audit trail
    logging/                 structured logger
    env.ts                   validated server configuration
  server/services/           business logic
  generated/prisma/          generated client (gitignored)
prisma/
  schema.prisma
  seed.ts
tests/
  unit/ integration/ e2e/
```

### Security model

Authorization is enforced **server-side, next to the data**, in
`src/lib/auth/dal.ts`. `src/proxy.ts` (Next.js 16's renamed middleware) only
checks whether a session cookie exists, to redirect signed-out users; it is a
convenience and never a boundary. Hiding a button in the UI is not an
authorization mechanism — the action behind it re-checks.

Sessions are database-backed rather than stateless, so suspending an account or
changing a password ends access immediately instead of at token expiry. Only a
SHA-256 digest of each session token is stored.

Roles (`SUPER_ADMIN`, `OPERATIONS`, `FINANCE`, `SUPPORT`, `READ_ONLY`) are
coarse labels; what each may actually do is the set of permission keys granted
to it in `RolePermission`, seeded from `src/lib/permissions/catalog.ts` and
tunable at runtime.

### Money

Amounts are integers in the currency's minor unit, in fields suffixed
`...Minor`, always stored beside an ISO-4217 currency column. Floating point is
never used for money. Amounts in different currencies are never summed without
an explicit exchange-rate policy — `sumMinor` throws rather than return a
meaningless total.

### What is deliberately not stored

Full card numbers, CVV and expiry dates are **not** captured, despite appearing
on the reference prototype's booking form. Storing a CVV is prohibited under
PCI DSS and storing a PAN brings the whole application into PCI scope. Payments
reference a provider transaction id; only a card brand and last four digits may
be retained.

### Claims this application does not make

Several reference modules describe behaviour that needs a real integration. Until
one is configured and verified, the CRM records and tracks state but does not
assert that an external action occurred:

- A payment is not successful because a URL or reference was saved — only
  `PaymentStatus` says so, and `PaymentCaptureMode` distinguishes a manually
  typed record from a provider-confirmed one.
- An internal message is not delivered because the row was written;
  `MessageStatus` starts at `DRAFT`/`QUEUED`, and `SENT` requires an actual
  send. Customer email is now genuinely sent when SMTP is configured — see
  below — and `NotificationStatus` distinguishes that from a message that was
  owed and never left.
- A generated PDF is marked `INTERNALLY_GENERATED` unless there is evidence the
  provider issued it.
- Creating a supplier record does not open a connection to an airline or cruise
  line.
- PNR decoding is unavailable until a supported integration exists; the raw PNR
  text is stored as typed.
- Chargeback cases are prepared and tracked; submission to a processor needs an
  integration or a documented manual procedure.

## Build status

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation, schema, auth, admin shell | Complete |
| 2 | Dashboard, flight bookings, customers | Complete |
| 3 | Cruise bookings, documents, protected viewing | Complete |
| 4 | Payments, refunds, chargebacks | Complete |
| 5 | High-priority, agents, suppliers, TFN, service, settings | Complete |
| 6 | Messaging, notifications, reports, CSV export | Complete |
| 7 | QA, security testing, deployment, backups | Complete |

Every sidebar entry now resolves to a real page. The `plannedInPhase` mechanism
remains for future work: an entry carrying it renders as a non-navigable label
with its phase number rather than a link that would 404, and
`tests/unit/navigation.test.ts` enforces that a built route is never left
marked as planned.

### CSV export

`src/lib/export/csv.ts` neutralises spreadsheet formula injection. A cell
beginning `=`, `+`, `-`, `@`, tab or carriage return is executed by Excel,
LibreOffice and Sheets, so a customer named
`=HYPERLINK("http://evil","click")` would run the moment someone opened the
file. Escaping quotes does not prevent this; the leading character is prefixed
with an apostrophe to force text interpretation.

Exports carry the list's active filters, omit financial columns for roles
without `payment.view`, cap at 10,000 rows while stating in the file itself
that it was truncated, and write an EXPORT audit entry.

### Testing

```bash
npm test          # 239 unit and integration tests, against a real MySQL
npm run test:e2e  # 22 browser tests, against a real server and database
```

Integration tests run against the development database rather than a mock, so
constraints, transactions and row locks are genuinely exercised. Browser tests
drive the real UI; only preconditions are arranged directly.

See `docs/DEPLOYMENT.md` for configuration, the deployment sequence, backups,
rollback and the production smoke-test checklist.

### Deploying to a Hostinger VPS

```bash
scripts/hostinger-setup.sh crm.example.com   # once: layout, systemd, nginx
scripts/hostinger-deploy.sh                  # every release after that
```

A deploy backs up, builds, migrates, switches an atomic symlink, restarts and
then polls `/api/health` — rolling back to the previous release if the new one
does not answer. `next.config.ts` sets `output: "standalone"`, so what runs on
the server is an 88 MB bundle rather than the 1.2 GB checkout that produced it.

Only a VPS plan works. Hostinger's Web Hosting and Cloud Hosting tiers are
PHP/LiteSpeed and cannot hold a long-lived Node process. The supporting files
are in `deploy/`; the full walkthrough is in `docs/DEPLOYMENT.md`.

### Agent passwords

The reference CRM renders every agent's password in a plaintext column. That is
not reproduced and cannot be. Passwords exist only as bcrypt digests on
`AdminUser`; no read path in the agent module selects `passwordHash`, and there
is no "view password" anywhere. Restoring access issues a one-time password
shown exactly once — it is verifiable against the stored digest but not
recoverable, including by a super administrator. Resetting also revokes every
live session for that account.

IP allowlisting is recorded per agent as a network control. It never replaces
authentication.

### Financial definitions

Every financial term has one documented meaning, in
`src/lib/financial/booking-balance.ts`. The ones that are routinely confused:

- **Gross booking value** — what the customer is contracted to pay. Independent
  of whether any money moved.
- **Collected** — captured payments only. A pending payment, an authorisation,
  or a saved payment link contributes nothing.
- **Refunded** — completed refunds only. An approved-but-unexecuted refund has
  not left the account.
- **Outstanding** — gross booking value less net collected, less adjustments.
- **Refundable** — collected less already refunded, floored at zero.

A booking's position is always derived from its payment, refund, chargeback and
adjustment rows; it is never stored, so it cannot drift from what it summarises.

### Refunds cannot be duplicated

Three independent mechanisms, all of them needed:

1. A unique index on `idempotencyKey`, so a retried submission returns the
   original refund instead of creating a second.
2. A `SELECT … FOR UPDATE` row lock on the booking held across the
   check-and-write, so two simultaneous requests cannot both read the same
   balance and both pass.
3. In-flight refunds counted against the refundable balance, so a second
   request for the same money is refused on its merits.

A refund also cannot be approved by the person who requested it, and amounts at
or above the configured threshold require a `SUPER_ADMIN`.

### Customer email

The customer is emailed when a booking reaches **CONFIRMED** and when it
reaches **TICKETED**. The trigger lives inside `transitionBooking`, the single
place a booking's status may change, so a new route or form cannot skip it.

Four properties, each with a reason:

- **The email cannot fail the booking.** It is dispatched after the transaction
  commits, through `after()`, so an SMTP timeout cannot roll back a confirmed
  booking or surface as an error on the status control. Every send path
  resolves rather than throws.
- **Nothing claims to have been sent that was not.** `NotificationStatus` is
  `SENT` only once the provider accepted the message, and the row then carries
  the provider and its message id. With `MAIL_DRIVER="none"` the notification
  is recorded as `SUPPRESSED` with the reason, so an operator can see that an
  email was owed and not sent.
- **The same event cannot email twice.** A unique `dedupeKey` of
  `booking:<id>:<event>` backs this, and re-applying a status the booking
  already has is a no-op that never reaches the mailer. Only an explicit
  operator resend may send a second copy.
- **The message carries nothing the customer should not receive.** No passport
  number, no date of birth, no supplier cost, no margin, no MCO figure — the
  query behind the template does not even load them. Integration tests assert
  the absence against a passenger that genuinely has a passport stored.

Configure with `MAIL_DRIVER="smtp"` plus `SMTP_HOST` and `MAIL_FROM`; see
`.env.example`. SMTP rather than a provider SDK, so changing provider is an
environment change. For local work, point it at a catcher such as Mailpit on
`127.0.0.1:1025` — a real send that never leaves the machine.

`npm run smoke` verifies the transport by completing an SMTP greeting and
authentication without sending, so a wrong host, port, TLS mode or credential
is found at deployment rather than by a customer who never got a confirmation.

### Document storage

Documents are stored through `src/lib/storage`, which currently uses a
local-disk adapter rooted at `STORAGE_LOCAL_ROOT` — outside `public/`, because
anything under `public/` is served to anyone by URL. Bytes leave the server only
through `/api/admin/documents/[id]/view`, which re-checks `document.view` on
every fetch; there is no public or pre-signed URL. Adding an S3 adapter is a
change to `getStorage()` alone.
