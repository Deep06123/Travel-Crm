import { expect, test, type Page } from "@playwright/test";

import {
  cleanupFixtures,
  createTestBooking,
  createTestCustomer,
  createTestUser,
  deleteTestMailAccounts,
  E2E_TAG,
  restoreMailAccounts,
  suspendMailAccounts,
  readBusinessSetting,
  signIn,
  writeBusinessSetting,
  type TestUser,
} from "./fixtures";

/**
 * Configuring the mailboxes customer email is sent from.
 *
 * Worth a browser test for the same reason as the notification addresses: what
 * breaks here is everything the service never sees. Whether the form posts at
 * all. Whether a password typed once is kept when the account is edited again
 * — the failure that would otherwise present as a mailbox that silently stops
 * authenticating. Whether the defaults survive a reload rather than merely
 * being echoed back. And whether a role without settings access is kept away
 * from a screen that holds SMTP credentials.
 *
 * The defaults row belongs to the installation rather than to this spec, so it
 * is read before the run and written straight back in `afterAll` — a failure
 * half-way must not leave somebody's email pointed at a fixture mailbox.
 */

const DEFAULTS_KEY = "mail_account_defaults";
const LABEL = `Reservations ${E2E_TAG}`;

let superAdmin: TestUser;
let readOnly: TestUser;
let originalDefaults: string | null = null;
let suspendedAccounts: string[] = [];

test.beforeAll(async () => {
  originalDefaults = await readBusinessSetting(DEFAULTS_KEY);

  // The development database is somebody's working copy and may already hold
  // real sending accounts. Taking them out of circulation for the run keeps
  // these assertions about this spec's own row.
  suspendedAccounts = await suspendMailAccounts();
  superAdmin = await createTestUser("SUPER_ADMIN", "mail-admin");
  readOnly = await createTestUser("READ_ONLY", "mail-readonly");
});

test.afterAll(async () => {
  await writeBusinessSetting(DEFAULTS_KEY, originalDefaults);
  await cleanupFixtures();
  await restoreMailAccounts(suspendedAccounts);
});

/**
 * Fills a field and proves it took.
 *
 * Same reasoning as the notification spec: a `fill()` landing before hydration
 * is reverted by the first client render, and the submit then posts whatever
 * is left.
 */
async function fillField(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true });

  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }).toPass({ timeout: 15_000 });
}

test("a super admin adds a sending account, edits it and sets the defaults", async ({
  page,
}) => {
  // A run that failed between creating the account and deleting it would
  // otherwise leave a second row matching the label.
  await deleteTestMailAccounts();

  await signIn(page, superAdmin);
  await page.goto("/admin/settings");

  await expect(
    page.getByRole("button", { name: "Add a sending account" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add a sending account" }).click();

  // A host with no from address is a half-built account; the form says so
  // rather than storing one that can never send.
  await fillField(page, "Name", LABEL);
  await fillField(page, "SMTP host", "smtp.example.invalid");
  await fillField(page, "From address", "reservations@example.invalid");
  await fillField(page, "Display name", "Reservations Desk");
  await fillField(page, "Username", "reservations@example.invalid");
  await fillField(page, "Password", "e2e-smtp-password");

  await page.getByRole("button", { name: "Add account" }).click();

  await expect(page.getByRole("status")).toContainText("Added");

  // Stored, not merely echoed: the card is rendered from the row on reload.
  await page.reload();
  await expect(page.getByText(LABEL, { exact: false }).first()).toBeVisible();
  await expect(
    page.getByText("Reservations Desk <reservations@example.invalid>"),
  ).toBeVisible();

  // Never tested yet, and the page says so instead of implying it works.
  // Scoped to this spec's own card: a disabled account left by an operator is
  // still listed, and it has never been tested either.
  const card = page.locator("li").filter({ hasText: LABEL });
  await expect(card.getByText("Never tested")).toBeVisible();

  // The password is not sent to the page — only the fact that one is stored.
  await card.getByRole("button", { name: "Edit" }).click();
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toHaveValue("");
  await expect(page.getByText("Stored. Leave empty to keep it.")).toBeVisible();

  // An edit that leaves the password box empty keeps the stored credential.
  // This is the one that matters: wiping it here would break a working
  // mailbox with no visible sign on the page.
  await fillField(page, "Display name", "Reservations Team");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.reload();
  await expect(
    page.getByText("Reservations Team <reservations@example.invalid>"),
  ).toBeVisible();
  await page.locator("li").filter({ hasText: LABEL }).getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText("Stored. Leave empty to keep it.")).toBeVisible();

  // Point the authorization email at it and prove the choice survives a
  // reload rather than being a value the form remembered.
  const authorization = page.getByLabel("Customer authorization");
  await expect(async () => {
    await authorization.selectOption({
      label: `${LABEL} — reservations@example.invalid`,
    });
  }).toPass({ timeout: 15_000 });

  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.reload();
  await expect(
    page.getByLabel("Customer authorization"),
  ).not.toHaveValue("");

  const stored = await readBusinessSetting(DEFAULTS_KEY);
  expect(stored).toContain("authorization");
});

test("the booking page offers the account as a sender once one exists", async ({
  page,
}) => {
  // Explicitly, rather than relying on this running before the test above:
  // the "none configured" branch is the point of the first assertion.
  await deleteTestMailAccounts();

  const customer = await createTestCustomer();
  const booking = await createTestBooking(customer.id, superAdmin.id);

  await signIn(page, superAdmin);

  // With nothing configured there is no choice to make, so there is no
  // control — only the route to creating one, and only for a role that could
  // follow it.
  await page.goto(`/admin/bookings/${booking.id}`);
  await expect(page.getByLabel("Send from").first()).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Add a sending account" }).first(),
  ).toBeVisible();

  // One account is enough to draw the picker: it is the only place on this
  // page that says which mailbox the customer will see.
  await page.goto("/admin/settings");
  await page.getByRole("button", { name: "Add a sending account" }).click();
  await fillField(page, "Name", LABEL);
  await fillField(page, "SMTP host", "smtp.example.invalid");
  await fillField(page, "From address", "reservations@example.invalid");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByRole("status")).toContainText("Added");

  await page.goto(`/admin/bookings/${booking.id}`);

  // Two of them: one over the authorization send, one over the e-ticket.
  const pickers = page.getByLabel("Send from");
  await expect(pickers).toHaveCount(2);

  await expect(pickers.first()).toContainText(
    `${LABEL} — reservations@example.invalid`,
  );
  // The first option, and the default: whatever Settings says for this kind
  // of message.
  await expect(pickers.first()).toHaveValue("");
});

test("a role without settings access cannot reach the SMTP credentials", async ({
  page,
}) => {
  await signIn(page, readOnly);

  const response = await page.goto("/admin/settings");

  // `settings.view` is SUPER_ADMIN-only under the default grants, so the page
  // is refused outright rather than the panel being hidden on it. 403, not
  // 500: a denial is not a server fault.
  expect(response?.status()).toBe(403);
  await expect(
    page.getByRole("button", { name: "Add a sending account" }),
  ).toHaveCount(0);
});
