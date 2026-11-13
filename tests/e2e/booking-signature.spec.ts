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

  // The page no longer asks for anything: neither the contact number, nor the
  // security table, nor a consent tick box is on it. Pressing the button is
  // the whole act, and the consent wording is still recorded against it.
  expect(await readSignature(booking.id)).toBeNull();
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  await page.getByRole("button", { name: "Sign & Confirm Booking" }).click();

  await expect(
    page.getByText("Your booking has been successfully signed and confirmed."),
  ).toBeVisible();

  const signature = await readSignature(booking.id);
  expect(signature).toMatchObject({ status: "SIGNED" });
  // Taken from the booking, which this fixture leaves blank — so it is
  // recorded as absent rather than as a confirmed empty string.
  expect(signature?.signedPhone).toBeNull();
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
  await expect(panel.getByText(customer.lastName)).toBeVisible();
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

  // The button is clickable by design — a greyed-out Send reads as broken and
  // hides its own explanation. The rule is enforced by `bookingEmailAction`,
  // which turns the send away in words before anything is transmitted, so that
  // is where this asserts it.
  await panel.getByRole("button", { name: /Send E-Ticket Email/i }).click();
  await expect(panel.getByText("so the e-ticket cannot be sent")).toBeVisible();
});

/**
 * A second authorization on a booking that was already signed.
 *
 * The panel re-fetches itself while it is waiting on a customer, and that is
 * the only thing that makes it current: the customer signs in their own
 * browser, so nothing in the operator's tab hears about it. The waiting
 * condition used to be "nothing has been signed yet", which is wrong the moment
 * an operator corrects a card and sends a fresh link — the panel then sat on
 * the previous signature until somebody reloaded the page by hand.
 *
 * Deliberately a browser test: the behaviour is an interval, a visibility
 * check and a router refresh, none of which exist outside a running page.
 */
test("a newer authorization reaches the panel without a reload", async ({
  page,
  browser,
}) => {
  // Two polls' worth of headroom, twice over: the panel re-fetches on a 15s
  // interval and this waits for it twice.
  test.setTimeout(150_000);

  const booking = await createTestBooking(customer.id, operations.id);
  const first = await seedSignatureRequest(
    booking.id,
    `first-${booking.bookingNumber}@example.invalid`,
    operations.id,
  );

  // The customer's own browser, kept open: the operator's tab must learn about
  // what happens here without being touched.
  const customerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();

  const sign = async (token: string) => {
    await customerPage.goto(`/sign/${token}`);
    await customerPage
      .getByRole("button", { name: "Sign & Confirm Booking" })
      .click();
    await expect(
      customerPage.getByText(
        "Your booking has been successfully signed and confirmed.",
      ),
    ).toBeVisible();
  };

  try {
    await sign(first.token);

    // What "Send a new authorization email" leaves behind, minus the SMTP
    // transport the browser suite deliberately does without. The operator opens
    // the booking after sending it, which is the state this is about: signed
    // once, and waiting on a second answer.
    const second = await seedSignatureRequest(
      booking.id,
      `second-${booking.bookingNumber}@example.invalid`,
      operations.id,
    );

    await signIn(page, operations);
    await page.goto(`/admin/bookings/${booking.id}`);

    const panel = page.locator("section", {
      has: page.getByRole("heading", {
        name: "Customer authorization",
        exact: true,
      }),
    });
    await expect(panel.getByText("Signed", { exact: true })).toBeVisible();
    await expect(
      panel.getByText(`first-${booking.bookingNumber}@example.invalid`),
    ).toBeVisible();

    // The panel says it is waiting rather than showing last time's signature as
    // if it were the whole story.
    await expect(
      panel.getByText("a newer link is awaiting the customer"),
    ).toBeVisible();

    await sign(second.token);

    // And the answer lands in the same tab, still without a reload.
    await expect(
      panel.getByText(`second-${booking.bookingNumber}@example.invalid`),
    ).toBeVisible({ timeout: 60_000 });
  } finally {
    await customerContext.close();
  }
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
