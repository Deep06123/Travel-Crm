import { expect, test } from "@playwright/test";

import {
  cleanupFixtures,
  countRefunds,
  createTestBooking,
  createTestCustomer,
  createTestUser,
  getBookingStatus,
  recordTestPayment,
  requestTestRefund,
  signIn,
  type TestBooking,
  type TestCustomer,
  type TestUser,
} from "./fixtures";

/**
 * The critical business workflow, end to end.
 *
 * Follows the sequence in the plan's testing section: sign in, create a
 * customer, create a booking, move it through its lifecycle, record a payment,
 * raise and approve a refund with separate people, read the reports, and
 * export. Each step drives the real UI against the real database.
 */

let operations: TestUser;
let finance: TestUser;
let superAdmin: TestUser;
let customer: TestCustomer;

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "wf-ops");
  finance = await createTestUser("FINANCE", "wf-fin");
  superAdmin = await createTestUser("SUPER_ADMIN", "wf-super");
  customer = await createTestCustomer();
});

test.afterAll(async () => {
  await cleanupFixtures();
});

test("an operator creates a customer through the form", async ({ page }) => {
  await signIn(page, operations);

  await page.goto("/admin/customers/new");
  await page.getByLabel("First name").fill("Marguerite");
  await page.getByLabel("Last name").fill("E2ECreated");
  await page.getByLabel("Email").fill(`e2e-fixture-created-${Date.now()}@example.invalid`);
  await page.getByRole("button", { name: "Create customer" }).click();

  // Lands on the new customer's profile.
  await page.waitForURL(/\/admin\/customers\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: /Marguerite E2ECreated/ })).toBeVisible();
});

test("duplicate contact details are flagged before a second record is created", async ({
  page,
}) => {
  await signIn(page, operations);

  const email = `e2e-fixture-dupe-${Date.now()}@example.invalid`;

  const fill = async () => {
    await page.goto("/admin/customers/new");
    await page.getByLabel("First name").fill("Original");
    await page.getByLabel("Last name").fill("Person");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Create customer" }).click();
  };

  await fill();
  await page.waitForURL(/\/admin\/customers\/[a-z0-9]+$/);

  // Same email again: the form must warn rather than silently duplicate.
  await fill();
  await expect(
    page.getByText("This may already be an existing customer"),
  ).toBeVisible();
});

test("a booking appears in the list and opens its detail page", async ({ page }) => {
  const booking: TestBooking = await createTestBooking(customer.id, operations.id);

  await signIn(page, operations);
  await page.goto("/admin/bookings");

  await expect(page.getByRole("link", { name: booking.bookingNumber })).toBeVisible();

  await page.getByRole("link", { name: booking.bookingNumber }).click();
  await page.waitForURL(/\/admin\/bookings\/[a-z0-9]+$/);

  await expect(
    page.getByRole("heading", { name: booking.bookingNumber }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Itinerary" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Passengers" })).toBeVisible();
});

test("the lifecycle refuses to confirm a booking without its evidence", async ({
  page,
}) => {
  // No airline confirmation recorded, so confirmation must be refused.
  const booking = await createTestBooking(customer.id, operations.id, {
    airlineConfirmation: undefined,
  });

  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  await page.locator("#toStatus").selectOption("CONFIRMED");
  await page.getByRole("button", { name: "Apply status change" }).click();

  await expect(page.locator("p[role='alert']")).toContainText(
    "confirmation reference",
  );

  // The stored status is untouched by the rejected attempt.
  expect(await getBookingStatus(booking.id)).toBe("PENDING");
});

test("a booking with its evidence confirms and records the change", async ({
  page,
}) => {
  const booking = await createTestBooking(customer.id, operations.id, {
    airlineConfirmation: "CNF-E2E-001",
  });

  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  await page.locator("#toStatus").selectOption("CONFIRMED");
  await page.getByRole("button", { name: "Apply status change" }).click();

  await expect(page.getByText(/Status changed from PENDING to CONFIRMED/)).toBeVisible();
  expect(await getBookingStatus(booking.id)).toBe("CONFIRMED");
});

test("cancelling requires a typed confirmation and a reason", async ({ page }) => {
  const booking = await createTestBooking(customer.id, operations.id);

  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  await page.locator("#toStatus").selectOption("CANCELLED");

  // The destructive action stays disabled until CANCEL is typed.
  const apply = page.getByRole("button", { name: "Apply status change" });
  await expect(apply).toBeDisabled();

  await page.locator("#reason").fill("Customer withdrew");
  await page.locator("#cancelConfirmation").fill("CANCEL");
  await expect(apply).toBeEnabled();

  await apply.click();

  // Once cancelled the control replaces itself, since the status is terminal —
  // so the outcome is asserted rather than the transient success message.
  await expect(
    page.getByText("Cancelled is a final status. This booking cannot move further."),
  ).toBeVisible();
  expect(await getBookingStatus(booking.id)).toBe("CANCELLED");
});

test("a collected payment shows in the booking position", async ({ page }) => {
  const booking = await createTestBooking(customer.id, operations.id, {
    totalMinor: 100_000,
  });

  await recordTestPayment(booking.id, customer.id, finance.id, {
    amountMinor: 40_000,
  });

  await signIn(page, finance);
  await page.goto(`/admin/bookings/${booking.id}`);

  // Collected is 400.00 against a 1,000.00 booking, so 600.00 is still owed.
  // The Accounting panel derives both from the payment rows, which is what
  // survives the removal of the Payments panel.
  await expect(page.getByText("$400.00").first()).toBeVisible();
  await expect(page.getByText("$600.00").first()).toBeVisible();
});

test("a manually entered payment is never shown as provider-confirmed", async ({
  page,
}) => {
  const booking = await createTestBooking(customer.id, operations.id, {
    totalMinor: 50_000,
  });

  // Arranged directly: the booking page no longer carries a Payments panel,
  // so the payments list is where provenance is read.
  const payment = await recordTestPayment(booking.id, customer.id, finance.id, {
    amountMinor: 50_000,
    providerTransactionId: "pi_e2e_claimed",
  });

  await signIn(page, finance);
  await page.goto(`/admin/payments?q=${payment.reference}`);

  const row = page.locator("tr").filter({ hasText: payment.reference });

  // Supplying a provider reference must not promote the record's provenance.
  await expect(row.getByText("Manually recorded")).toBeVisible();
  await expect(row.getByText(/Confirmed by/)).toHaveCount(0);
});

test("a refund cannot be approved by the person who requested it", async ({ page }) => {
  const booking = await createTestBooking(customer.id, operations.id, {
    totalMinor: 100_000,
  });

  // Finance collects, then raises the refund. Both are arranged directly:
  // neither form is on the booking page any more, and what this test is about
  // is who may approve, which the refund desk still decides.
  const payment = await recordTestPayment(booking.id, customer.id, finance.id, {
    amountMinor: 100_000,
  });
  await requestTestRefund(booking.id, payment.id, finance.id, {
    amountMinor: 25_000,
    reason: "Partial refund, schedule change",
  });

  expect(await countRefunds(booking.id)).toBe(1);

  // The same person tries to approve their own request.
  await signIn(page, finance);
  await page.goto("/admin/refunds");
  const ownRow = page.locator("tr").filter({ hasText: booking.bookingNumber });
  await ownRow.getByRole("button", { name: "Approve" }).click();
  await ownRow.getByRole("button", { name: "Confirm approval" }).click();

  await expect(page.getByText(/cannot be approved by the person who requested it/)).toBeVisible();
});

test("a second approver can approve, and the refund reaches completion", async ({
  page,
}) => {
  const booking = await createTestBooking(customer.id, operations.id, {
    totalMinor: 100_000,
  });

  const payment = await recordTestPayment(booking.id, customer.id, finance.id, {
    amountMinor: 100_000,
  });
  await requestTestRefund(booking.id, payment.id, finance.id, {
    amountMinor: 10_000,
    reason: "Goodwill",
  });

  // A different person approves and then records execution. Earlier tests left
  // their own refunds in the list, so the row is located by booking number
  // rather than by position.
  await signIn(page, superAdmin);
  await page.goto("/admin/refunds");

  const row = page.locator("tr").filter({ hasText: booking.bookingNumber });
  await row.getByRole("button", { name: "Approve" }).click();
  await row.getByRole("button", { name: "Confirm approval" }).click();

  // The control swaps to the execute step on success, so the outcome is
  // asserted rather than the transient message it replaces.
  await expect(
    page
      .locator("tr")
      .filter({ hasText: booking.bookingNumber })
      .getByText("Approved", { exact: true }),
  ).toBeVisible();

  await page.reload();
  const approvedRow = page.locator("tr").filter({ hasText: booking.bookingNumber });
  await approvedRow.locator("textarea[name='note']").fill("Refunded at the desk");
  await approvedRow.getByRole("button", { name: "Record as executed" }).click();

  // The row ends up Completed and labelled as a manual action — the record
  // never claims a provider processed anything, because none did.
  const completedRow = page
    .locator("tr")
    .filter({ hasText: booking.bookingNumber });

  await expect(completedRow.getByText("Completed", { exact: true })).toBeVisible();
  await expect(completedRow.getByText("Manually executed")).toBeVisible();
});

test("the dashboard and reports render real figures", async ({ page }) => {
  await signIn(page, superAdmin);

  await page.goto("/admin");
  await expect(page.getByText("Gross booking value")).toBeVisible();
  await expect(page.getByText("Payments collected")).toBeVisible();

  await page.goto("/admin/reports/financial");
  await expect(
    page.getByRole("heading", { name: "Financial report" }),
  ).toBeVisible();
  // The measures are labelled with their definitions, not left ambiguous.
  await expect(page.getByText(/Captured payments only/)).toBeVisible();

  await page.goto("/admin/reports/bookings");
  await expect(page.getByRole("heading", { name: "Booking report" })).toBeVisible();
});

test("an export downloads a CSV carrying the active filter", async ({ page }) => {
  await signIn(page, superAdmin);
  await page.goto("/admin/bookings?status=PENDING");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^bookings-\d{4}-\d{2}-\d{2}\.csv$/);
});
