import { expect, test, type Page } from "@playwright/test";

import {
  cleanupFixtures,
  createTestBooking,
  createTestCustomer,
  createTestUser,
  readBusinessSetting,
  signIn,
  writeBusinessSetting,
  type TestUser,
} from "./fixtures";

/**
 * The remaining edit and delete controls: comments, customers, business
 * settings and the audit log.
 *
 * One file rather than four, because each is a short exercise of the same
 * pattern — a dialog, a server action, a redraw — and the thing being proved
 * is that the wiring reaches the database, not that four nearly identical
 * components each render.
 *
 * The business setting under test is restored in `afterAll`: that row belongs
 * to the installation, and a failure half-way must not leave somebody's
 * refund threshold at a fixture value.
 */

const THRESHOLD_KEY = "refund_approval_threshold_minor";

let superAdmin: TestUser;
let originalThreshold: string | null = null;

test.beforeAll(async () => {
  superAdmin = await createTestUser("SUPER_ADMIN", "rows-admin");
  originalThreshold = await readBusinessSetting(THRESHOLD_KEY);
});

test.afterAll(async () => {
  await writeBusinessSetting(THRESHOLD_KEY, originalThreshold);
  await cleanupFixtures();
});

/** Adds a comment to a booking through the form on its page. */
async function addComment(page: Page, bookingId: string, body: string) {
  await page.goto(`/admin/bookings/${bookingId}`);
  // By id: every existing comment's edit dialog carries a field labelled
  // "Comment" too, and the add form's id is unique.
  await page.locator("#comment-body").fill(body);
  await page.getByRole("button", { name: "Add comment" }).click();

  // The paragraph, not any text: each comment's edit dialog holds a textarea
  // containing the same words, closed but present in the DOM.
  await expect(page.locator("p").filter({ hasText: body }).first()).toBeVisible();
}

test("a comment can be edited and deleted from the booking thread", async ({
  page,
}) => {
  const customer = await createTestCustomer();
  const booking = await createTestBooking(customer.id, superAdmin.id);

  await signIn(page, superAdmin);

  const original = `Original note ${Date.now()}`;
  await addComment(page, booking.id, original);

  // The comment's own row, so the controls found below are its own.
  const item = page.locator("li").filter({ hasText: original });

  await item.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  const editField = dialog.locator("textarea[name='body']");
  await expect(editField).toHaveValue(original);

  const edited = `${original} — corrected`;
  await editField.fill(edited);
  await dialog.getByRole("button", { name: "Save comment" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(
    page.locator("p").filter({ hasText: edited }).first(),
  ).toBeVisible();

  // Delete is not behind a typed confirmation: the body is written to the
  // audit log first, so it is recoverable in the sense that matters.
  const edits = page.locator("li").filter({ hasText: edited });
  await edits.getByRole("button", { name: "Delete" }).click();

  const confirm = page.getByRole("dialog");
  await confirm.getByRole("button", { name: "Delete comment" }).click();
  await expect(confirm).toBeHidden();

  await page.reload();
  await expect(page.locator("p").filter({ hasText: edited })).toHaveCount(0);
});

test("a customer with no history is deleted; one with bookings is not", async ({
  page,
}) => {
  const spare = await createTestCustomer();
  const booked = await createTestCustomer();
  await createTestBooking(booked.id, superAdmin.id);

  await signIn(page, superAdmin);
  await page.goto("/admin/customers?q=Testcase");

  const spareRow = page.getByRole("row").filter({ hasText: spare.reference });
  const bookedRow = page.getByRole("row").filter({ hasText: booked.reference });

  await expect(spareRow).toBeVisible();
  await expect(bookedRow).toBeVisible();

  // The fork: nothing references the first, a booking references the second.
  await expect(spareRow.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(bookedRow.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(
    bookedRow.getByRole("button", { name: "Deactivate" }),
  ).toBeVisible();

  const name = `${spare.firstName} ${spare.lastName}`;
  await spareRow.getByRole("button", { name: "Delete" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(`Type ${name} below to confirm`).fill(name);
  await dialog.getByRole("button", { name: "Delete for good" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(
    page.getByRole("row").filter({ hasText: spare.reference }),
  ).toHaveCount(0);
});

test("a business setting is edited and restored to its default", async ({
  page,
}) => {
  await signIn(page, superAdmin);
  await page.goto("/admin/settings");

  const row = page
    .getByRole("row")
    .filter({ hasText: "Refund approval threshold" });

  await row.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");

  // Rejected rather than stored: the readers expect a whole number of minor
  // units, and a word here would reach the refund rules.
  await dialog.getByLabel("Value").fill("not a number");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toContainText("whole number");

  await dialog.getByLabel("Value").fill("75000");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  // Rendered as money by the table, which is how the page already showed it.
  await expect(page.getByText("$750.00")).toBeVisible();
  expect(await readBusinessSetting(THRESHOLD_KEY)).toContain("75000");

  // Restore deletes the row so the built-in constant applies again.
  await page
    .getByRole("row")
    .filter({ hasText: "Refund approval threshold" })
    .getByRole("button", { name: "Restore default" })
    .click();

  const restore = page.getByRole("dialog");
  await restore.getByRole("button", { name: "Restore the default" }).click();
  await expect(restore).toBeHidden();

  await page.reload();
  expect(await readBusinessSetting(THRESHOLD_KEY)).toBeNull();
});

test("deleting an audit entry records its own deletion", async ({ page }) => {
  await signIn(page, superAdmin);
  await page.goto("/admin/audit-logs");

  const firstRow = page.getByRole("row").nth(1);

  // Column 4, not 3: the selection checkbox is the first cell for anyone who
  // can delete. The first line only, because the summary cell also renders the
  // changed fields underneath and those are not part of the sentence matched
  // later.
  const summary =
    (await firstRow.locator("td").nth(4).innerText()).split("\n")[0]?.trim() ??
    "";

  await firstRow.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog");

  // DELETE rather than a name: an audit entry has none, and a word you had to
  // read first is the only friction available on a control this cheap.
  const submit = dialog.getByRole("button", { name: "Delete the entry" });
  await expect(submit).toBeDisabled();

  await dialog.getByLabel("Type DELETE below to confirm").fill("DELETE");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(dialog).toBeHidden();

  await page.reload();

  // The scar: removing an entry writes a new one naming what was removed, so
  // this is never a silent hole.
  await expect(
    page.getByText("Deleted an audit entry").first(),
  ).toBeVisible();

  // And it names what was removed, so the entry is answerable afterwards.
  if (summary !== "") {
    await expect(
      page.getByText(summary, { exact: false }).first(),
    ).toBeVisible();
  }
});

test("a selection of audit entries is deleted in one go", async ({ page }) => {
  await signIn(page, superAdmin);
  await page.goto("/admin/audit-logs");

  const rows = page.getByRole("row");
  const before = await rows.count();
  test.skip(before < 4, "Needs at least three audit entries to select from");

  // Two rows, ticked individually — the bar only counts what is on screen.
  await rows.nth(1).getByRole("checkbox").check();
  await rows.nth(2).getByRole("checkbox").check();

  await expect(page.getByText("2 entries selected on this page")).toBeVisible();

  await page.getByRole("button", { name: "Delete 2 entries" }).click();
  const dialog = page.getByRole("dialog");

  // The same typed confirmation as the single row: a larger mistake has more
  // claim to the friction, not less.
  const submit = dialog.getByRole("button", { name: "Delete them for good" });
  await expect(submit).toBeDisabled();

  await dialog.getByLabel("Type DELETE below to confirm").fill("DELETE");
  await submit.click();
  await expect(dialog).toBeHidden();

  // The bar goes with the selection it was describing.
  await expect(
    page.getByText("2 entries selected on this page"),
  ).toBeHidden();

  await page.reload();

  // One scar for the pair, rather than one per row.
  await expect(page.getByText("Deleted 2 audit entries").first()).toBeVisible();
});

test("selecting the header checkbox takes the whole page, and clears", async ({
  page,
}) => {
  await signIn(page, superAdmin);
  await page.goto("/admin/audit-logs");

  const rowCount = (await page.getByRole("row").count()) - 1;
  test.skip(rowCount < 1, "No audit entries in this database");

  await page
    .getByRole("checkbox", { name: "Select every entry on this page" })
    .check();

  await expect(
    page.getByText(
      `${rowCount} ${rowCount === 1 ? "entry" : "entries"} selected on this page`,
    ),
  ).toBeVisible();

  // Nothing is removed here: the assertion is about the control, and these are
  // somebody's development entries.
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(page.getByText("selected on this page")).toBeHidden();
});
