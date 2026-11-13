import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";
import mysql from "mysql2/promise";

import { SmtpSink, decodeQuotedPrintable } from "../helpers/smtp-sink";
import {
  cleanupFixtures,
  createTestBooking,
  createTestCustomer,
  createTestUser,
  restoreMailAccounts,
  seedSignatureRequest,
  signIn,
  suspendMailAccounts,
  type TestCustomer,
  type TestUser,
} from "./fixtures";

/**
 * What the operator typed is what leaves the building.
 *
 * The rest of the suite deliberately sends through an unreachable host — the
 * point there is the refusal, not the message. This file is the exception: it
 * stands up a real SMTP server on loopback and points a sending account at it,
 * because the only way to prove an edit survived is to read the bytes that
 * crossed the socket.
 *
 * It exists because of a report that an edited message arrived with the
 * generated wording. The editor posted correctly and the service rendered
 * correctly; what did not was the panel's own Send button, which sits in a
 * separate form — the editor cannot be nested inside it without invalid HTML —
 * and posted no subject or body at all. Clicking the Send an operator had been
 * using all along therefore discarded the edit on screen and sent the
 * generated message, with nothing on the page to say so.
 */

let operations: TestUser;
let customer: TestCustomer;

const sink = new SmtpSink();
let accountId = "";
let suspended: readonly string[] = [];

async function connect() {
  return mysql.createConnection(process.env["DATABASE_URL"]!);
}

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "authsend-ops");
  customer = await createTestCustomer();

  const port = await sink.start();

  // `resolveMailer` prefers a configured account over the SMTP_* environment,
  // so an operator's real mailbox has to be switched off for the duration or
  // this file would send through it.
  suspended = await suspendMailAccounts();

  accountId = randomBytes(12).toString("hex");
  const connection = await connect();
  await connection.execute(
    `INSERT INTO \`MailAccount\`
       (\`id\`, \`label\`, \`fromEmail\`, \`fromName\`, \`host\`, \`port\`,
        \`secure\`, \`isActive\`, \`createdAt\`, \`updatedAt\`)
     VALUES (?, 'authorization sink', 'sink@example.test', 'Sink',
             '127.0.0.1', ?, false, true, NOW(3), NOW(3))`,
    [accountId, port],
  );
  await connection.end();
});

test.afterAll(async () => {
  const connection = await connect();
  await connection.execute("DELETE FROM `MailAccount` WHERE `id` = ?", [
    accountId,
  ]);
  await connection.end();

  await restoreMailAccounts(suspended);
  await sink.stop();
  await cleanupFixtures();
});

const EDITED_SUBJECT = "Please check these details before we ticket";
const EDITED_BODY = "Sent from the editor, not the template.";

/** The generated opening, which must not survive an edit. */
const GENERATED = "Greetings for the day";

async function openEditorAndType(page: import("@playwright/test").Page) {
  const panel = page.locator("section", {
    has: page.getByRole("heading", {
      name: "Customer authorization",
      exact: true,
    }),
  });

  await panel.getByRole("button", { name: "Edit email" }).first().click();
  await panel.getByLabel("Subject").fill(EDITED_SUBJECT);
  await panel.getByLabel("Message").fill(EDITED_BODY);

  return panel;
}

test("the editor's own button sends the edited message", async ({ page }) => {
  sink.messages.length = 0;
  const booking = await createTestBooking(customer.id, operations.id);

  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  const panel = await openEditorAndType(page);

  // The editor's own button, named for the version in front of it.
  await panel.getByRole("button", { name: "Send this version" }).click();
  await expect(panel.getByText(/Authorization email sent to/)).toBeVisible({
    timeout: 30_000,
  });

  const message = decodeQuotedPrintable(sink.messages[0]!.data);
  expect(message).toContain(`Subject: ${EDITED_SUBJECT}`);
  expect(message).toContain(EDITED_BODY);
  expect(message).not.toContain(GENERATED);
});

/**
 * The reported defect, from the operator's side.
 *
 * With the editor open, the Send button above it must send what is in the
 * editor. It used to submit its own form, which carries no subject or body,
 * and the customer received the generated wording.
 */
test("the panel's Send button sends the edited message too", async ({
  page,
}) => {
  sink.messages.length = 0;
  const booking = await createTestBooking(customer.id, operations.id);

  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  const panel = await openEditorAndType(page);

  // The one above the editor — the button an operator has been clicking all
  // along, and the one that used to throw the edit away.
  await panel.getByRole("button", { name: "Send the edited version" }).click();
  await expect(panel.getByText(/Authorization email sent to/)).toBeVisible({
    timeout: 30_000,
  });

  expect(sink.messages).toHaveLength(1);
  const message = decodeQuotedPrintable(sink.messages[0]!.data);
  expect(message).toContain(`Subject: ${EDITED_SUBJECT}`);
  expect(message).toContain(EDITED_BODY);
  expect(message).not.toContain(GENERATED);
});

/**
 * The preview has to show the message the customer is holding.
 *
 * "View email" re-renders the booking, so it showed the generated wording
 * however many edited sends had gone out. An operator opening it to check what
 * they had just sent was shown a different email from the one in the inbox.
 */
test("View email shows the message that was actually sent", async ({
  page,
  context,
}) => {
  sink.messages.length = 0;
  const booking = await createTestBooking(customer.id, operations.id);

  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  const panel = await openEditorAndType(page);
  await panel.getByRole("button", { name: "Send this version" }).click();
  await expect(panel.getByText(/Authorization email sent to/)).toBeVisible({
    timeout: 30_000,
  });

  const [preview] = await Promise.all([
    context.waitForEvent("page"),
    panel.getByRole("link", { name: "View email" }).click(),
  ]);
  await preview.waitForLoadState();

  // The subject sits above the frame; the message is inside it, rendered by
  // the same code that built the email.
  await expect(preview.getByText(EDITED_SUBJECT)).toBeVisible();

  const body = preview.frameLocator(
    'iframe[title="Authorization email preview"]',
  );
  await expect(body.getByText(EDITED_BODY)).toBeVisible();
  await expect(body.getByText(GENERATED)).toHaveCount(0);

  await preview.close();

  // And reopening the editor starts from that message rather than the
  // template, with a way back to the template offered beside it.
  await panel.getByRole("button", { name: "Edit email" }).first().click();
  await expect(panel.getByLabel("Message")).toHaveValue(EDITED_BODY);

  await panel.getByRole("button", { name: "Use the generated message" }).click();
  // `toHaveValue`, not `toContainText`: restoring sets the field's value, and
  // a textarea's text content is still whatever it was rendered with.
  await expect(panel.getByLabel("Message")).toHaveValue(
    new RegExp(GENERATED),
  );
});

/**
 * The e-ticket, which remembers an edit the same way.
 *
 * Its send is gated on a signature, so this signs first rather than asserting
 * against the refusal. The editor is the shared one, so what is being checked
 * here is the e-ticket's own storage and preview — not the editor again.
 */
test("the e-ticket remembers an edit and shows it on its own page", async ({
  page,
  browser,
}) => {
  sink.messages.length = 0;
  // Ticketed, because that is the booking an e-ticket is sent for — and the
  // preview page renders the document for the booking's own status.
  const booking = await createTestBooking(customer.id, operations.id, {
    status: "TICKETED",
  });

  // The customer's half, in its own browser: the e-ticket cannot be sent until
  // the authorization has been signed.
  const signature = await seedSignatureRequest(
    booking.id,
    `eticket-${booking.bookingNumber}@example.invalid`,
    operations.id,
  );

  const customerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();

  try {
    await customerPage.goto(`/sign/${signature.token}`);
    await customerPage
      .getByRole("button", { name: "Sign & Confirm Booking" })
      .click();
    await expect(
      customerPage.getByText(
        "Your booking has been successfully signed and confirmed.",
      ),
    ).toBeVisible();
  } finally {
    await customerContext.close();
  }

  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  const panel = page.locator("section", {
    has: page.getByRole("heading", {
      name: "Customer authorization",
      exact: true,
    }),
  });

  // The second Edit in this panel belongs to the e-ticket block.
  await panel.getByRole("button", { name: "Edit email" }).nth(1).click();
  await expect(panel.getByText("E-ticket email", { exact: true })).toBeVisible();

  // The authorization editor is closed, so these are the e-ticket's own.
  await panel.getByLabel("Subject").fill(EDITED_SUBJECT);
  await panel.getByLabel("Message").fill(EDITED_BODY);

  await panel.getByRole("button", { name: "Send the edited version" }).click();
  await expect(
    panel.getByText("Your edited email was sent to the customer."),
  ).toBeVisible({ timeout: 30_000 });

  // It went out as written.
  const message = decodeQuotedPrintable(
    sink.messages[sink.messages.length - 1]!.data,
  );
  expect(message).toContain(`Subject: ${EDITED_SUBJECT}`);
  expect(message).toContain(EDITED_BODY);

  // The document went with it: an edit replaces the opening message and the
  // subject, never the ticket itself.
  expect(message).toContain("E-TICKET IS ISSUED");
  expect(message).toContain(booking.bookingNumber);
  expect(message).toContain("Traveler Details");

  // And "View e-ticket" shows that same email — the operator's opening above
  // the generated document.
  await page.goto(`/admin/bookings/${booking.id}/eticket`);

  // The subject sits above the frame, as on the authorization preview: it is
  // editable and it is the first thing the customer reads.
  await expect(page.getByText(EDITED_SUBJECT)).toBeVisible();

  const document = page.frameLocator('iframe[title="E-ticket preview"]');
  await expect(document.getByText(EDITED_BODY)).toBeVisible();
  await expect(document.getByText("YOUR E-TICKET IS ISSUED!!")).toBeVisible();
  await expect(document.getByText("Greetings for the day")).toHaveCount(0);

  // The way back is the editor's own restore, as on the authorization.
  await page.goto(`/admin/bookings/${booking.id}`);
  await panel.getByRole("button", { name: "Edit email" }).nth(1).click();
  await expect(panel.getByLabel("Message")).toHaveValue(EDITED_BODY);

  await panel.getByRole("button", { name: "Use the generated message" }).click();
  await expect(panel.getByLabel("Message")).toHaveValue(
    /Greetings for the day/,
  );
});

/** And with no editor open it still sends the generated message. */
test("the panel's Send button sends the generated message on its own", async ({
  page,
}) => {
  sink.messages.length = 0;
  const booking = await createTestBooking(customer.id, operations.id);

  await signIn(page, operations);
  await page.goto(`/admin/bookings/${booking.id}`);

  const panel = page.locator("section", {
    has: page.getByRole("heading", {
      name: "Customer authorization",
      exact: true,
    }),
  });

  await panel.getByRole("button", { name: "Send authorization email" }).click();
  await expect(panel.getByText(/Authorization email sent to/)).toBeVisible({
    timeout: 30_000,
  });

  const message = decodeQuotedPrintable(sink.messages[0]!.data);
  expect(message).toContain(GENERATED);
});
