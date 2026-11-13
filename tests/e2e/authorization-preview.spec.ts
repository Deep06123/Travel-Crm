import { expect, test } from "@playwright/test";

import {
  cleanupFixtures,
  createTestBooking,
  createTestCustomer,
  createTestMailAccount,
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

  // The page states what the confirm button will do. Production says the
  // button is inert; a development build says it issues a real link, because
  // there it is the only way to reach the signing page on a machine with no
  // mail transport. Either wording satisfies the property under test — that
  // the operator is told, rather than left to assume.
  await expect(
    preview.getByText(/This is a preview|Development build/),
  ).toBeVisible();

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
  //
  // The button stays clickable on purpose: a greyed-out Send reads as broken,
  // and the operator never finds the sentence underneath explaining why. The
  // rule lives in `bookingEmailAction`, which refuses the send and answers in
  // words, so the control says why rather than merely resisting.
  await expect(
    panel.getByRole("button", { name: /Send E-Ticket Email/i }),
  ).toBeEnabled();
  await expect(
    panel.getByText("The customer has not signed the authorization yet."),
  ).toBeVisible();

  const [preview] = await Promise.all([
    context.waitForEvent("page"),
    panel.getByRole("link", { name: "View e-ticket" }).click(),
  ]);

  await preview.waitForLoadState();
  await expect(preview).toHaveURL(
    new RegExp(`/admin/bookings/${booking.id}/eticket$`),
  );
  await preview.close();

  // And the refusal is real, not a disabled button: clicking Send on an
  // unsigned booking is turned away by the action before anything is
  // transmitted. This is the half the old `toBeDisabled` assertion stood in
  // for, now checked where the rule actually lives.
  await panel.getByRole("button", { name: /Send E-Ticket Email/i }).click();
  await expect(
    panel.getByText("so the e-ticket cannot be sent"),
  ).toBeVisible();
});

/**
 * The sender picker's first option is "Default for this email", and it posts
 * an empty string. The action's schema required a non-empty id when the field
 * was present at all, so every submit made without choosing a named account —
 * the normal case — came back "Invalid request." and the editor never opened.
 *
 * Only reproducible with an account configured: with none, the picker is not
 * drawn and the field is absent, which the schema accepts.
 */
test("the email editor opens with the default sender selected", async ({
  page,
}) => {
  await createTestMailAccount("authview");
  const booking = await createTestBooking(customer.id, operations.id);

  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  const panel = page.locator("section", {
    has: page.getByRole("heading", {
      name: "Customer authorization",
      exact: true,
    }),
  });

  const sender = panel.getByLabel("Send from").first();
  await expect(sender).toHaveValue("");

  await panel.getByRole("button", { name: "Edit email" }).first().click();

  await expect(panel.getByText("Invalid request.")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Send this version" }),
  ).toBeVisible();
});

/** The same defect, in the action behind the e-ticket's own editor. */
test("the e-ticket editor opens with the default sender selected", async ({
  page,
}) => {
  await createTestMailAccount("authview-eticket");
  const booking = await createTestBooking(customer.id, operations.id);

  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  const panel = page.locator("section", {
    has: page.getByRole("heading", {
      name: "Customer authorization",
      exact: true,
    }),
  });

  // The second picker and the second Edit belong to the e-ticket block.
  await expect(panel.getByLabel("Send from").nth(1)).toHaveValue("");
  await panel.getByRole("button", { name: "Edit email" }).nth(1).click();

  await expect(panel.getByText("Invalid request.")).toHaveCount(0);
  await expect(panel.getByText("E-ticket email", { exact: true })).toBeVisible();
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
