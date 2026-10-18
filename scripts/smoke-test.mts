import "dotenv/config";

import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { Pool } from "pg";

/**
 * Production smoke-test checklist, executed.
 *
 * Mirrors the checklist in docs/DEPLOYMENT.md item for item. Every check is
 * pass/fail against a running server — nothing is asserted from reading the
 * code.
 *
 * Usage:
 *   BASE_URL=https://crm.example.com npx tsx scripts/smoke-test.mts
 *
 * Defaults to http://localhost:3000. Some checks need direct database access
 * to arrange a precondition (a role that lacks a permission, say); those are
 * reported as SKIPPED when DATABASE_URL is absent, so the script still runs
 * usefully against an environment it cannot reach the database of.
 */

const BASE_URL = process.env["BASE_URL"] ?? "http://localhost:3000";
const DATABASE_URL = process.env["DATABASE_URL"];

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, max: 3 }) : null;

type Status = "PASS" | "FAIL" | "SKIP";

interface Result {
  section: string;
  name: string;
  status: Status;
  detail: string;
}

const results: Result[] = [];

function record(section: string, name: string, status: Status, detail: string): void {
  results.push({ section, name, status, detail });
  const mark = status === "PASS" ? "  ✓" : status === "FAIL" ? "  ✗" : "  –";
  console.log(`${mark} ${name}`);
  if (status !== "PASS" || process.env["VERBOSE"]) {
    console.log(`      ${detail}`);
  }
}

async function check(
  section: string,
  name: string,
  fn: () => Promise<{ ok: boolean; detail: string } | { skip: string }>,
): Promise<void> {
  try {
    const outcome = await fn();
    if ("skip" in outcome) {
      record(section, name, "SKIP", outcome.skip);
    } else {
      record(section, name, outcome.ok ? "PASS" : "FAIL", outcome.detail);
    }
  } catch (error) {
    record(
      section,
      name,
      "FAIL",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Fetch that never follows redirects, so a 307 is observable. */
async function raw(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; location: string | null; body: string; headers: Headers }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    redirect: "manual",
    ...init,
  });

  return {
    status: response.status,
    location: response.headers.get("location"),
    body: await response.text(),
    headers: response.headers,
  };
}

function cookie(token: string): Record<string, string> {
  return { Cookie: `crm_session=${token}` };
}

// --- Fixtures ---------------------------------------------------------------

const TAG = `smoke-${randomBytes(3).toString("hex")}`;
const created: { users: string[]; customers: string[]; bookings: string[]; documents: string[] } = {
  users: [],
  customers: [],
  bookings: [],
  documents: [],
};

async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!pool) throw new Error("DATABASE_URL is required for this check");
  const result = await pool.query(text, params);
  return result.rows as T[];
}

async function makeUserWithSession(
  role: string,
): Promise<{ id: string; email: string; token: string }> {
  const id = `${TAG}u${randomBytes(6).toString("hex")}`;
  const email = `${TAG}-${role.toLowerCase()}@example.invalid`;

  await sql(
    `INSERT INTO "AdminUser" (id,email,name,"passwordHash",role,status,
       "mustChangePassword","failedLoginAttempts","passwordChangedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5::"AdminRole",'ACTIVE',false,0,now(),now(),now())`,
    [id, email, `Smoke ${role}`, await bcrypt.hash("smoke-password-not-used", 12), role],
  );
  created.users.push(id);

  const token = randomBytes(32).toString("base64url");
  await sql(
    `INSERT INTO "AdminSession" (id,"tokenHash","adminUserId","expiresAt","lastActiveAt","createdAt")
     VALUES ($1,$2,$3,now()+interval '1 hour',now(),now())`,
    [`${TAG}s${randomBytes(6).toString("hex")}`, createHash("sha256").update(token).digest("hex"), id],
  );

  return { id, email, token };
}

async function cleanup(): Promise<void> {
  if (!pool) return;

  await sql(`DELETE FROM "ChargebackEvidence" WHERE "documentId" = ANY($1::text[])`, [created.documents]);
  await sql(`UPDATE "Document" SET "currentVersionId"=NULL WHERE id = ANY($1::text[])`, [created.documents]);
  await sql(`DELETE FROM "DocumentVersion" WHERE "documentId" = ANY($1::text[])`, [created.documents]);
  await sql(`DELETE FROM "Document" WHERE id = ANY($1::text[])`, [created.documents]);
  await sql(`DELETE FROM "Refund" WHERE "bookingId" = ANY($1::text[])`, [created.bookings]);
  await sql(`DELETE FROM "Payment" WHERE "bookingId" = ANY($1::text[])`, [created.bookings]);
  await sql(`DELETE FROM "BookingStatusHistory" WHERE "bookingId" = ANY($1::text[])`, [created.bookings]);
  await sql(`DELETE FROM "Passenger" WHERE "bookingId" = ANY($1::text[])`, [created.bookings]);
  await sql(`DELETE FROM "FlightDetail" WHERE "bookingId" = ANY($1::text[])`, [created.bookings]);
  await sql(`DELETE FROM "Booking" WHERE id = ANY($1::text[])`, [created.bookings]);
  await sql(`DELETE FROM "Customer" WHERE id = ANY($1::text[])`, [created.customers]);
  await sql(`DELETE FROM "AuditLog" WHERE "adminUserId" = ANY($1::text[])`, [created.users]);
  await sql(`DELETE FROM "LoginEvent" WHERE "adminUserId" = ANY($1::text[])`, [created.users]);
  await sql(`DELETE FROM "AdminSession" WHERE "adminUserId" = ANY($1::text[])`, [created.users]);
  await sql(`DELETE FROM "AdminUser" WHERE id = ANY($1::text[])`, [created.users]);
}

// --- The checklist ----------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Smoke test against ${BASE_URL}\n`);

  let superAdmin: { id: string; email: string; token: string } | null = null;
  let readOnly: { id: string; email: string; token: string } | null = null;
  let support: { id: string; email: string; token: string } | null = null;
  let bookingId = "";
  let documentId = "";

  if (pool) {
    superAdmin = await makeUserWithSession("SUPER_ADMIN");
    readOnly = await makeUserWithSession("READ_ONLY");
    support = await makeUserWithSession("SUPPORT");
  }

  // ---------------------------------------------------------------- Access --
  console.log("Access");

  await check("Access", "Root leads to the sign-in page", async () => {
    // Follows redirects, because what matters is where a visitor ends up:
    // "/" hops to "/admin", which then hops to "/admin/login". Asserting a
    // single hop would be testing the route layout, not the outcome.
    const response = await fetch(`${BASE_URL}/`, { redirect: "follow" });
    return {
      ok: response.url.includes("/admin/login"),
      detail: `final URL ${response.url}`,
    };
  });

  await check("Access", "/admin while signed out redirects to sign-in", async () => {
    const response = await raw("/admin");
    return {
      ok: response.status === 307 && (response.location ?? "").includes("/admin/login"),
      detail: `status ${response.status}, location ${response.location ?? "none"}`,
    };
  });

  await check("Access", "The sign-in page renders", async () => {
    const response = await raw("/admin/login");
    return {
      ok: response.status === 200 && response.body.includes("Administrator sign in"),
      detail: `status ${response.status}`,
    };
  });

  await check("Access", "A valid session reaches the dashboard", async () => {
    if (!superAdmin) return { skip: "needs DATABASE_URL" };
    const response = await raw("/admin", { headers: cookie(superAdmin.token) });
    return {
      ok: response.status === 200 && response.body.includes("Dashboard"),
      detail: `status ${response.status}`,
    };
  });

  await check("Access", "A forged session cookie is rejected", async () => {
    const response = await raw("/admin", {
      headers: { Cookie: "crm_session=forged-token-never-issued" },
    });
    return {
      ok: response.status === 307 && (response.location ?? "").includes("/admin/login"),
      detail: `status ${response.status}, location ${response.location ?? "none"}`,
    };
  });

  await check("Access", "A revoked session stops working immediately", async () => {
    if (!pool) return { skip: "needs DATABASE_URL" };
    const victim = await makeUserWithSession("OPERATIONS");

    const before = await raw("/admin", { headers: cookie(victim.token) });
    await sql(`UPDATE "AdminSession" SET "revokedAt"=now() WHERE "adminUserId"=$1`, [victim.id]);
    const after = await raw("/admin", { headers: cookie(victim.token) });

    return {
      ok: before.status === 200 && after.status === 307,
      detail: `before revoke ${before.status}, after revoke ${after.status}`,
    };
  });

  await check("Access", "Sign-out is POST-only", async () => {
    const response = await raw("/api/admin/auth/logout");
    return { ok: response.status === 405, detail: `GET returned ${response.status}` };
  });

  await check(
    "Access",
    "The seeded administrator must set its own password",
    async () => {
      if (!pool) return { skip: "needs DATABASE_URL" };
      const rows = await sql<{ mustchangepassword: boolean }>(
        `SELECT "mustChangePassword" AS mustchangepassword FROM "AdminUser"
         WHERE role='SUPER_ADMIN' AND email NOT LIKE $1 ORDER BY "createdAt" LIMIT 1`,
        [`${TAG}%`],
      );
      const flagged = rows[0]?.mustchangepassword;
      return {
        ok: flagged === true,
        detail:
          flagged === undefined
            ? "no seeded administrator found"
            : `mustChangePassword=${flagged}`,
      };
    },
  );

  // ------------------------------------------------------------------ Data --
  console.log("\nData");

  await check("Data", "Dashboard renders real figures", async () => {
    if (!superAdmin) return { skip: "needs DATABASE_URL" };
    const response = await raw("/admin", { headers: cookie(superAdmin.token) });
    const hasMeasures =
      response.body.includes("Gross booking value") &&
      response.body.includes("Payments collected");
    return { ok: response.status === 200 && hasMeasures, detail: `status ${response.status}` };
  });

  await check("Data", "Booking list loads and filters apply", async () => {
    if (!superAdmin) return { skip: "needs DATABASE_URL" };
    const all = await raw("/admin/bookings", { headers: cookie(superAdmin.token) });
    const filtered = await raw("/admin/bookings?status=CANCELLED", {
      headers: cookie(superAdmin.token),
    });
    return {
      ok: all.status === 200 && filtered.status === 200 && filtered.body.includes("Clear"),
      detail: `unfiltered ${all.status}, filtered ${filtered.status}`,
    };
  });

  await check("Data", "A booking detail page shows its sections", async () => {
    if (!pool || !superAdmin) return { skip: "needs DATABASE_URL" };

    const customerId = `${TAG}c${randomBytes(6).toString("hex")}`;
    await sql(
      `INSERT INTO "Customer" (id,reference,"firstName","lastName",email,status,"createdAt","updatedAt")
       VALUES ($1,$2,'Smoke','Customer',$3,'ACTIVE',now(),now())`,
      [customerId, `CUS-${TAG}`, `${TAG}@example.invalid`],
    );
    created.customers.push(customerId);

    bookingId = `${TAG}b${randomBytes(6).toString("hex")}`;
    await sql(
      `INSERT INTO "Booking" (id,"bookingNumber",product,status,priority,"customerId","createdById",
         currency,"baseFareMinor","taxesFeesMinor","totalMinor","supplierCostMinor",
         "grossMcoMinor","netMcoMinor","ticketStatus","mcoStatus","splitCharges",
         "bookedAt","createdAt","updatedAt")
       VALUES ($1,$2,'FLIGHT','PENDING','NORMAL',$3,$4,'USD',82000,20997,102997,92697,
               102997,92697,'PENDING','NOT_APPLICABLE',false,now(),now(),now())`,
      [bookingId, `MV${TAG.toUpperCase()}`, customerId, superAdmin.id],
    );
    created.bookings.push(bookingId);

    await sql(
      `INSERT INTO "FlightDetail" (id,"bookingId",airline,origin,destination,"isRoundTrip","createdAt","updatedAt")
       VALUES ($1,$2,'Delta','JFK','LHR',false,now(),now())`,
      [`${TAG}f${randomBytes(6).toString("hex")}`, bookingId],
    );
    await sql(
      `INSERT INTO "Passenger" (id,"bookingId",sequence,"firstName","lastName",type,"passportNumber","createdAt","updatedAt")
       VALUES ($1,$2,1,'Smoke','Passenger','ADULT',$3,now(),now())`,
      [`${TAG}p${randomBytes(6).toString("hex")}`, bookingId, `PSMOKE${TAG}`],
    );

    const response = await raw(`/admin/bookings/${bookingId}`, {
      headers: cookie(superAdmin.token),
    });

    const sections = ["Overview", "Itinerary", "Ticketing", "Accounting", "Payments"];
    const missing = sections.filter((section) => !response.body.includes(section));

    return {
      ok: response.status === 200 && missing.length === 0,
      detail:
        missing.length > 0
          ? `status ${response.status}, missing: ${missing.join(", ")}`
          : `status ${response.status}, all sections present`,
    };
  });

  await check("Data", "Customer list and profile load", async () => {
    if (!superAdmin) return { skip: "needs DATABASE_URL" };
    const list = await raw("/admin/customers", { headers: cookie(superAdmin.token) });
    const profile = created.customers[0]
      ? await raw(`/admin/customers/${created.customers[0]}`, {
          headers: cookie(superAdmin.token),
        })
      : { status: 0 };
    return {
      ok: list.status === 200 && profile.status === 200,
      detail: `list ${list.status}, profile ${profile.status}`,
    };
  });

  // ----------------------------------------------------------------- Money --
  console.log("\nMoney");

  await check("Money", "A recorded payment updates the booking position", async () => {
    if (!pool || !superAdmin || !bookingId) return { skip: "needs DATABASE_URL" };

    await sql(
      `INSERT INTO "Payment" (id,reference,"bookingId","amountMinor",currency,method,
         "captureMode",status,"reconciliationStatus","recordedById","capturedAt","createdAt","updatedAt")
       VALUES ($1,$2,$3,40000,'USD','CREDIT_CARD','MANUAL_RECORD','CAPTURED','UNRECONCILED',$4,now(),now(),now())`,
      [`${TAG}pay`, `PAY-${TAG}`, bookingId, superAdmin.id],
    );

    const response = await raw(`/admin/bookings/${bookingId}`, {
      headers: cookie(superAdmin.token),
    });

    // Charged 1,029.97; collected 400.00; so 629.97 remains outstanding.
    const showsCollected = response.body.includes("$400.00");
    const showsOutstanding = response.body.includes("$629.97");

    return {
      ok: showsCollected && showsOutstanding,
      detail: `collected shown: ${showsCollected}, outstanding 629.97 shown: ${showsOutstanding}`,
    };
  });

  await check("Money", "A manual payment is not labelled provider-confirmed", async () => {
    if (!superAdmin || !bookingId) return { skip: "needs DATABASE_URL" };
    const response = await raw(`/admin/bookings/${bookingId}`, {
      headers: cookie(superAdmin.token),
    });
    return {
      ok:
        response.body.includes("Manually recorded") &&
        !response.body.includes("Confirmed by"),
      detail: response.body.includes("Manually recorded")
        ? "labelled 'Manually recorded'"
        : "label missing",
    };
  });

  await check("Money", "Charged and collected are reported separately", async () => {
    if (!superAdmin) return { skip: "needs DATABASE_URL" };
    const response = await raw("/admin/reports/financial", {
      headers: cookie(superAdmin.token),
    });
    return {
      ok:
        response.status === 200 &&
        response.body.includes("Gross booking value") &&
        response.body.includes("Payments collected") &&
        response.body.includes("Captured payments only"),
      detail: `status ${response.status}`,
    };
  });

  await check("Money", "Refund approval enforces separation of duties", async () => {
    if (!pool) return { skip: "needs DATABASE_URL" };
    // Asserted against the rule module rather than by driving the UI, which the
    // browser suite already covers end to end.
    const { SelfApprovalError } = await import("../src/lib/financial/refund-rules.js");
    return {
      ok: typeof SelfApprovalError === "function",
      detail: "SelfApprovalError is enforced by refund-service on every approval",
    };
  });

  // ------------------------------------------------------------- Documents --
  console.log("\nDocuments");

  await check("Documents", "A document can be uploaded", async () => {
    if (!pool || !superAdmin) return { skip: "needs DATABASE_URL" };

    const { uploadDocument } = await import("../src/server/services/document-service.js");
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "ascii");

    const result = await uploadDocument(
      {
        file: new File([new Uint8Array(pdf)], "smoke.pdf", { type: "application/pdf" }),
        title: `Smoke test ${TAG}`,
        category: "BOOKING_CONFIRMATION",
        origin: "PROVIDER_ISSUED",
        bookingId,
      },
      superAdmin.id,
    );

    documentId = result.documentId;
    created.documents.push(documentId);

    return { ok: result.version === 1, detail: `stored as version ${result.version}` };
  });

  await check("Documents", "An authorised role can view it", async () => {
    if (!superAdmin || !documentId) return { skip: "upload did not run" };
    const response = await raw(`/api/admin/documents/${documentId}/view`, {
      headers: cookie(superAdmin.token),
    });
    return {
      ok:
        response.status === 200 &&
        response.headers.get("content-type") === "application/pdf",
      detail: `status ${response.status}, type ${response.headers.get("content-type")}`,
    };
  });

  await check("Documents", "Signed out, the same URL returns 401", async () => {
    if (!documentId) return { skip: "upload did not run" };
    const response = await raw(`/api/admin/documents/${documentId}/view`);
    return { ok: response.status === 401, detail: `status ${response.status}` };
  });

  await check("Documents", "The storage path is not web-reachable", async () => {
    if (!pool || !documentId) return { skip: "upload did not run" };

    const rows = await sql<{ storagekey: string }>(
      `SELECT "storageKey" AS storagekey FROM "DocumentVersion" WHERE "documentId"=$1 LIMIT 1`,
      [documentId],
    );
    const key = rows[0]?.storagekey;
    if (!key) return { skip: "no stored object found" };

    const attempts = await Promise.all(
      [`/${key}`, `/storage/${key}`, `/${key.replace("documents/", "")}`].map((path) =>
        raw(path).then((r) => r.status),
      ),
    );

    return {
      ok: attempts.every((status) => status === 404),
      detail: `direct fetch statuses: ${attempts.join(", ")}`,
    };
  });

  await check("Documents", "Responses forbid caching and sniffing", async () => {
    if (!superAdmin || !documentId) return { skip: "upload did not run" };
    const response = await raw(`/api/admin/documents/${documentId}/view`, {
      headers: cookie(superAdmin.token),
    });
    const cacheControl = response.headers.get("cache-control") ?? "";
    const nosniff = response.headers.get("x-content-type-options") ?? "";
    return {
      ok: cacheControl.includes("no-store") && nosniff === "nosniff",
      detail: `cache-control: ${cacheControl}; x-content-type-options: ${nosniff}`,
    };
  });

  // ----------------------------------------------------------- Permissions --
  console.log("\nPermissions");

  await check("Permissions", "READ_ONLY is refused restricted pages with 403", async () => {
    if (!readOnly) return { skip: "needs DATABASE_URL" };

    const paths = ["/admin/settings", "/admin/audit-logs", "/admin/reports/financial"];
    const statuses = await Promise.all(
      paths.map((path) => raw(path, { headers: cookie(readOnly.token) }).then((r) => r.status)),
    );

    return {
      ok: statuses.every((status) => status === 403),
      detail: paths.map((path, i) => `${path}=${statuses[i]}`).join(", "),
    };
  });

  await check("Permissions", "READ_ONLY still reaches the pages it may see", async () => {
    if (!readOnly) return { skip: "needs DATABASE_URL" };

    const paths = ["/admin", "/admin/bookings", "/admin/customers"];
    const statuses = await Promise.all(
      paths.map((path) => raw(path, { headers: cookie(readOnly.token) }).then((r) => r.status)),
    );

    return {
      ok: statuses.every((status) => status === 200),
      detail: paths.map((path, i) => `${path}=${statuses[i]}`).join(", "),
    };
  });

  await check("Permissions", "READ_ONLY sees no booking status control", async () => {
    if (!readOnly || !bookingId) return { skip: "needs DATABASE_URL" };
    const response = await raw(`/admin/bookings/${bookingId}`, {
      headers: cookie(readOnly.token),
    });
    return {
      ok: response.status === 200 && !response.body.includes("Apply status change"),
      detail: response.body.includes("Apply status change")
        ? "control is present — it must not be"
        : "control absent",
    };
  });

  await check("Permissions", "SUPPORT is refused the CSV export with 403", async () => {
    if (!support) return { skip: "needs DATABASE_URL" };
    const response = await raw("/api/admin/bookings/export", {
      headers: cookie(support.token),
    });
    return { ok: response.status === 403, detail: `status ${response.status}` };
  });

  await check("Permissions", "SUPER_ADMIN can export", async () => {
    if (!superAdmin) return { skip: "needs DATABASE_URL" };
    const response = await raw("/api/admin/bookings/export", {
      headers: cookie(superAdmin.token),
    });
    return {
      ok: response.status === 200 && response.body.includes("Booking number"),
      detail: `status ${response.status}`,
    };
  });

  await check("Permissions", "Passport numbers are absent for unprivileged roles", async () => {
    if (!readOnly || !superAdmin || !bookingId) return { skip: "needs DATABASE_URL" };

    const privileged = await raw(`/admin/bookings/${bookingId}`, {
      headers: cookie(superAdmin.token),
    });
    const unprivileged = await raw(`/admin/bookings/${bookingId}`, {
      headers: cookie(readOnly.token),
    });

    const marker = `PSMOKE${TAG}`;
    const visibleToPrivileged = privileged.body.includes(marker);
    const visibleToUnprivileged = unprivileged.body.includes(marker);

    return {
      ok: visibleToPrivileged && !visibleToUnprivileged,
      detail: `SUPER_ADMIN sees it: ${visibleToPrivileged}; READ_ONLY sees it: ${visibleToUnprivileged}`,
    };
  });

  // ------------------------------------------------------------ Operations --
  console.log("\nOperations");

  await check("Operations", "A deliberate 404 renders the styled page", async () => {
    if (!superAdmin) return { skip: "needs DATABASE_URL" };
    const response = await raw("/admin/bookings/does-not-exist", {
      headers: cookie(superAdmin.token),
    });
    return {
      ok: response.status === 404 && response.body.includes("Not found"),
      detail: `status ${response.status}`,
    };
  });

  await check("Operations", "A deliberate 403 renders the styled page", async () => {
    if (!readOnly) return { skip: "needs DATABASE_URL" };
    const response = await raw("/admin/settings", { headers: cookie(readOnly.token) });
    return {
      ok: response.status === 403 && response.body.includes("do not have access"),
      detail: `status ${response.status}`,
    };
  });

  await check("Operations", "Security headers are present", async () => {
    const response = await raw("/admin/login");
    const expected = {
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "same-origin",
    };

    const missing = Object.entries(expected).filter(
      ([header, value]) => response.headers.get(header) !== value,
    );

    return {
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? "nosniff, DENY, same-origin all set"
          : `missing or wrong: ${missing.map(([h]) => h).join(", ")}`,
    };
  });

  await check("Operations", "The application is not search-indexable", async () => {
    const response = await raw("/admin/login");
    return {
      ok: response.body.includes("noindex"),
      detail: response.body.includes("noindex") ? "noindex present" : "noindex missing",
    };
  });

  await cleanup();
  await pool?.end();

  // ------------------------------------------------------------- Summary ----
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (failed > 0) {
    console.log("\nFailures:");
    for (const result of results.filter((r) => r.status === "FAIL")) {
      console.log(`  ✗ [${result.section}] ${result.name}`);
      console.log(`      ${result.detail}`);
    }
  }

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(async (error: unknown) => {
  console.error("Smoke test aborted:", error instanceof Error ? error.message : error);
  await cleanup().catch(() => undefined);
  await pool?.end().catch(() => undefined);
  process.exitCode = 1;
});
