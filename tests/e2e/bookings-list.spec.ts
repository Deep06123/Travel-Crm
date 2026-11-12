import { expect, test, type Page } from "@playwright/test";

import {
  cleanupFixtures,
  createTestBooking,
  createTestCustomer,
  createTestUser,
  getBookingStatus,
  seedSignatureRequest,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * The bookings list: the three columns an operator reads it for.
 *
 * Driven through the browser rather than asserted on the service, because
 * every one of these is a claim about what reaches the screen. The MCO column
 * read "N/A" over bookings carrying a gross MCO, the follow-up column restated
 * what the Booked column already said, and the status could only be changed
 * two pages away — none of which a service-level test would have noticed.
 */

let admin: TestUser;

test.beforeAll(async () => {
  admin = await createTestUser("SUPER_ADMIN", "bookings-list");
});

test.afterAll(async () => {
  await cleanupFixtures();
});

/** The list, filtered to one booking, and that booking's row. */
async function rowFor(page: Page, bookingNumber: string) {
  await page.goto(`/admin/bookings?q=${encodeURIComponent(bookingNumber)}`);

  const row = page.locator("tr").filter({ hasText: bookingNumber });
  await expect(row).toBeVisible();

  return row;
}

/**
 * The MCO column, with a raised MCO and without one.
 *
 * Both halves matter. The complaint was that the column read N/A over a
 * booking carrying a gross MCO — but the fix cannot be to stop saying N/A,
 * because a booking with no MCO genuinely has none and the column has to keep
 * being able to say so.
 */
test("the MCO column reports a raised MCO rather than N/A", async ({ page }) => {
  const customer = await createTestCustomer();
  const raised = await createTestBooking(customer.id, admin.id, {
    mcoStatus: "PENDING",
  });
  const none = await createTestBooking(customer.id, admin.id);

  await signIn(page, admin);

  const withMco = await rowFor(page, raised.bookingNumber);
  // The settlement state, and the money beside it — the two must agree.
  await expect(withMco).toContainText("Pending");
  await expect(withMco).toContainText("$1,029.97");

  const withoutMco = await rowFor(page, none.bookingNumber);
  await expect(withoutMco).toContainText("N/A");
});

test("the auth email column replaces follow-up and reports what was sent", async ({
  page,
}) => {
  const customer = await createTestCustomer();
  const unsent = await createTestBooking(customer.id, admin.id);
  const sent = await createTestBooking(customer.id, admin.id);

  await seedSignatureRequest(
    sent.id,
    `authorization-${sent.bookingNumber}@example.invalid`,
    admin.id,
  );

  await signIn(page, admin);

  // The column itself, by its heading. The old one must be gone: leaving both
  // would be two columns competing to say what is outstanding.
  await page.goto("/admin/bookings");
  await expect(
    page.getByRole("columnheader", { name: "Auth email" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Follow-up" }),
  ).toHaveCount(0);

  const neverSent = await rowFor(page, unsent.bookingNumber);
  await expect(neverSent).toContainText("Not sent");

  const awaiting = await rowFor(page, sent.bookingNumber);
  await expect(awaiting).toContainText("Pending");
});

test("the status badge moves a booking from pending to confirmed", async ({
  page,
}) => {
  const customer = await createTestCustomer();
  // Confirming needs a passenger, which the service checks against the stored
  // row — so the fixture supplies one. It no longer needs a confirmation
  // reference; see the refusal case below for what it does still need.
  const booking = await createTestBooking(customer.id, admin.id, {
    status: "PENDING",
    withPassenger: true,
  });

  await signIn(page, admin);
  const row = await rowFor(page, booking.bookingNumber);

  await row.getByRole("button", { name: /Change its status/ }).click();
  await row.getByRole("menuitem", { name: "Confirmed" }).click();

  // By the control's accessible name rather than the word: the badge and its
  // screen-reader label both read "Confirmed", and a bare text match is
  // ambiguous between them.
  await expect(
    row.getByRole("button", { name: /is Confirmed/ }),
  ).toBeVisible();
  expect(await getBookingStatus(booking.id)).toBe("CONFIRMED");
});

/**
 * The refusal path, which is the reason the control shows an error at all.
 *
 * Confirmation itself no longer checks any evidence, so the rule still
 * reachable from this control is the matrix: the lifecycle runs one way, and
 * a confirmed booking does not go back to pending. The menu offers both
 * states regardless — it is a list row, with no room to explain why an option
 * is absent — so the refusal has to arrive as a message rather than as a
 * missing entry, or the click just appears to do nothing.
 */
test("moving a confirmed booking back to pending is refused, with the reason shown", async ({
  page,
}) => {
  const customer = await createTestCustomer();
  const booking = await createTestBooking(customer.id, admin.id, {
    status: "CONFIRMED",
  });

  await signIn(page, admin);
  const row = await rowFor(page, booking.bookingNumber);

  await row.getByRole("button", { name: /Change its status/ }).click();
  await row.getByRole("menuitem", { name: "Pending" }).click();

  await expect(row.getByRole("alert")).toContainText(
    "cannot move from CONFIRMED to PENDING",
  );
  expect(await getBookingStatus(booking.id)).toBe("CONFIRMED");
});

test("the actions column offers the authorization as a download", async ({
  page,
}) => {
  const customer = await createTestCustomer();
  const booking = await createTestBooking(customer.id, admin.id);

  await signIn(page, admin);
  const row = await rowFor(page, booking.bookingNumber);

  const download = row.getByRole("link", { name: "Download authorization" });
  await expect(download).toHaveAttribute(
    "href",
    `/api/admin/bookings/${booking.id}/authorization/download`,
  );

  // Nothing is signed, so this is the email itself — served as an attachment
  // rather than rendered, because it is markup built from booking fields and
  // must not run on this origin.
  const response = await page.request.get(
    `/api/admin/bookings/${booking.id}/authorization/download`,
  );

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(response.headers()["content-disposition"]).toContain("attachment");
  expect(response.headers()["content-disposition"]).toContain(
    booking.bookingNumber,
  );
});
