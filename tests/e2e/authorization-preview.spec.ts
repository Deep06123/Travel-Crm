import { expect, test } from "@playwright/test";

import {
  cleanupFixtures,
  createTestBooking,
  createTestCustomer,
  createTestUser,
  signIn,
  type TestCustomer,
  type TestUser,
} from "./fixtures";

/**
 * Reading the two customer-facing documents before they are sent.
 *
 * The property worth a browser test is that looking is not sending. Both
 * previews sit inside a form whose submit button sends an email, so a link
 * that accidentally submitted — or a preview that minted a signing token —
 * would put something in a customer's inbox on a click an operator
 * reasonably expects to be read-only.
 */

let operations: TestUser;
let customer: TestCustomer;

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "authview-ops");
  customer = await createTestCustomer();
});

test.afterAll(async () => {
  await cleanupFixtures();
});

test("the authorization email can be read without sending or issuing a link", async ({
  page,
  context,
}) => {
  const booking = await createTestBooking(customer.id, operations.id);

  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  const panel = page.locator("section", {
    has: page.getByRole("heading", {
      name: "Customer authorization",
      exact: true,
    }),
  });

  const [preview] = await Promise.all([
    context.waitForEvent("page"),
    panel.getByRole("link", { name: "View email" }).click(),
  ]);

  await preview.waitForLoadState();
  await expect(preview).toHaveURL(
    new RegExp(`/admin/bookings/${booking.id}/authorization$`),
  );

  // The message itself, rendered by the same code that builds the email body.
  const body = preview.frameLocator('iframe[title="Authorization email preview"]');
  await expect(body.getByText("CLICK TO CONFIRM")).toBeVisible();
  await expect(body.getByText(booking.bookingNumber).first()).toBeVisible();

  // The preview says the link is inert, and means it.
  await expect(preview.getByText("This is a preview")).toBeVisible();

  await preview.close();

  // Nothing was sent, and no signing link was issued: the panel still reports
  // the booking as never having been asked.
  await page.reload();
  await expect(
    panel.getByText("has not been asked to authorize"),
  ).toBeVisible();
});

test("the e-ticket can be read while its send is still blocked", async ({
  page,
  context,
}) => {
  const booking = await createTestBooking(customer.id, operations.id);

  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  const panel = page.locator("section", {
    has: page.getByRole("heading", {
      name: "Customer authorization",
      exact: true,
    }),
  });

  // Unsigned, so sending is refused — but checking the document is not.
  await expect(
    panel.getByRole("button", { name: /Send E-Ticket Email/i }),
  ).toBeDisabled();

  const [preview] = await Promise.all([
    context.waitForEvent("page"),
    panel.getByRole("link", { name: "View e-ticket" }).click(),
  ]);

  await preview.waitForLoadState();
  await expect(preview).toHaveURL(
    new RegExp(`/admin/bookings/${booking.id}/eticket$`),
  );
});

test("reading the authorization email needs the same permission as sending it", async ({
  page,
}) => {
  const booking = await createTestBooking(customer.id, operations.id);
  const readOnly = await createTestUser("READ_ONLY", "authview-ro");

  await signIn(page, readOnly);
  await page.goto(`/admin/bookings/${booking.id}/authorization`);

  // It carries the card's last four and the billing address, so it is not a
  // page a role without the send capability may read.
  await expect(page.getByText("CLICK TO CONFIRM")).toHaveCount(0);
});
