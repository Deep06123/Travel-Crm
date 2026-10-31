import { expect, test } from "@playwright/test";

import {
  cleanupFixtures,
  createTestBooking,
  createTestCustomer,
  createTestUser,
  readSignature,
  seedSignatureRequest,
  signIn,
  type TestCustomer,
  type TestUser,
} from "./fixtures";

/**
 * The customer authorization flow, end to end.
 *
 * The signing page is the only part of this application a customer ever sees,
 * so the browser visits it the way a customer would: signed out, holding
 * nothing but the link. That is the property worth testing in a browser rather
 * than in an integration test — that the page is genuinely reachable without a
 * session, and that the admin side is genuinely not.
 *
 * The link is seeded rather than sent, because sending needs a working SMTP
 * transport and these tests are about the page, not about delivery. The
 * integration suite covers the email itself.
 */

let operations: TestUser;
let customer: TestCustomer;

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "sig-ops");
  customer = await createTestCustomer();
});

test.afterAll(async () => {
  await cleanupFixtures();
});

test("a customer signs the authorization and the evidence reaches the booking", async ({
  page,
  context,
}) => {
  const booking = await createTestBooking(customer.id, operations.id);
  const { token } = await seedSignatureRequest(
    booking.id,
    `signer-${booking.bookingNumber}@example.invalid`,
    operations.id,
  );

  // No cookies at all: the customer has never been near the admin interface.
  await context.clearCookies();
  await page.goto(`/sign/${token}`);

  await expect(
    page.getByRole("heading", { name: "Booking Confirmation & E-Signature" }),
  ).toBeVisible();
  await expect(page.getByText(booking.bookingNumber)).toBeVisible();

  // The consent gate holds before anything is recorded.
  await page.getByRole("button", { name: "Sign & Confirm Booking" }).click();
  await expect(
    page.getByText("Please accept the electronic signature consent."),
  ).toBeVisible();
  expect(await readSignature(booking.id)).toBeNull();

  await page.getByRole("checkbox").check();
  await page.getByLabel("Mobile number").fill("+1 555 0100");
  await page.getByRole("button", { name: "Sign & Confirm Booking" }).click();

  await expect(
    page.getByText("Your booking has been successfully signed and confirmed."),
  ).toBeVisible();

  const signature = await readSignature(booking.id);
  expect(signature).toMatchObject({
    status: "SIGNED",
    signedPhone: "+1 555 0100",
  });
  // Observed by the server from the request, never posted by the page.
  expect(signature?.ipAddress).toBeTruthy();
  expect(signature?.browser).toBeTruthy();

  // Re-opening the same link cannot produce a second signature.
  await page.goto(`/sign/${token}`);
  await expect(
    page.getByRole("heading", { name: "This booking is already confirmed" }),
  ).toBeVisible();

  // And the agent sees the evidence on the booking.
  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  const panel = page.locator("section", {
    has: page.getByRole("heading", {
      name: "Customer authorization",
      exact: true,
    }),
  });
  await expect(panel.getByText("+1 555 0100")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /Send E-Ticket Email/i }),
  ).toBeEnabled();
});

test("the e-ticket cannot be sent before the customer has signed", async ({
  page,
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
  await expect(
    panel.getByText("has not been asked to authorize"),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /Send E-Ticket Email/i }),
  ).toBeDisabled();
});

test("an unknown link shows nothing about any booking", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto("/sign/not-a-real-token");

  await expect(
    page.getByRole("heading", { name: "This link is not valid" }),
  ).toBeVisible();
  // A wrong token must not confirm that any booking exists.
  await expect(page.getByText(/MVE2E/)).toHaveCount(0);
});
