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
| Database | PostgreSQL |
| ORM | Prisma 7 with the `@prisma/adapter-pg` driver adapter |
| Validation | Zod 4 |
| Tables / charts | TanStack Table, Recharts |
| Forms | React Hook Form + Zod |
| Logging | Pino, structured, with field redaction |
| Tests | Vitest (unit, integration), Playwright (end-to-end) |

## Getting started

```bash
npm install
cp .env.example .env     # then fill in DATABASE_URL and AUTH_SECRET
npm run db:migrate       # applies migrations
npm run db:seed          # permissions, roles, reference data, first admin
npm run dev
```

The seed prints a one-time password for the first administrator when
`INITIAL_ADMIN_PASSWORD` is not set. The account is flagged to change it at
first sign-in.

### Creating the local database

```bash
sudo -u postgres psql -c "CREATE ROLE travel_crm LOGIN PASSWORD 'devpassword';"
sudo -u postgres psql -c "CREATE DATABASE travel_crm OWNER travel_crm;"
```

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
- A message is not delivered because the row was written; `MessageStatus`
  starts at `DRAFT`/`QUEUED`, and `SENT` requires an actual send.
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
| 4 | Payments, refunds, chargebacks | Not started |
| 5 | High-priority, agents, suppliers, TFN, service, settings | Not started |
| 6 | Messaging, notifications, reports, CSV export | Not started |
| 7 | QA, security testing, deployment, backups | Not started |

Sidebar entries for unbuilt modules render as non-navigable labels carrying
their phase number, so the intended structure stays visible without any link
leading to a 404. `tests/unit/navigation.test.ts` enforces this.

### Document storage

Documents are stored through `src/lib/storage`, which currently uses a
local-disk adapter rooted at `STORAGE_LOCAL_ROOT` — outside `public/`, because
anything under `public/` is served to anyone by URL. Bytes leave the server only
through `/api/admin/documents/[id]/view`, which re-checks `document.view` on
every fetch; there is no public or pre-signed URL. Adding an S3 adapter is a
change to `getStorage()` alone.
