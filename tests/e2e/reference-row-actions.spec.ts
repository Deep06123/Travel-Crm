import { expect, test } from "@playwright/test";

import {
  cleanupFixtures,
  createTestUser,
  deleteTestReferenceData,
  E2E_TAG,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Editing and removing reference data from the table it is listed in.
 *
 * The behaviour worth a browser test is the fork: a record nothing references
 * can be deleted outright, and one a booking points at cannot — the database
 * refuses it, so the control has to be Deactivate instead. Getting that wrong
 * produces a button that always fails, which is the thing this is here to
 * stop.
 *
 * MCO suppliers stand in for all three tables. Suppliers and TFNs render the
 * same two components with a different noun, so a third copy of this would
 * test the test rather than the code.
 */

const LABEL = `Acme Settlements ${E2E_TAG}`;

let superAdmin: TestUser;

test.beforeAll(async () => {
  superAdmin = await createTestUser("SUPER_ADMIN", "ref-admin");
});

test.afterAll(async () => {
  await cleanupFixtures();
});

test("an unused MCO supplier can be edited and then deleted", async ({
  page,
}) => {
  // A previous run that failed between creating the row and deleting it would
  // otherwise leave two rows matching the tag.
  await deleteTestReferenceData();

  await signIn(page, superAdmin);
  await page.goto("/admin/mco-suppliers");

  // Scoped to the add panel: every row carries a closed edit dialog holding
  // the same form, so an unscoped `getByLabel` matches one field per supplier.
  const addPanel = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add MCO supplier" }),
  });

  await addPanel.getByLabel("MCO supplier name").fill(LABEL);
  await addPanel.getByRole("button", { name: "Add MCO supplier" }).click();
  await expect(page.getByRole("status")).toContainText("added");

  await page.reload();

  const row = page.getByRole("row", { name: new RegExp(E2E_TAG) });
  await expect(row).toBeVisible();

  // Nothing references it, so the control is a real delete.
  await expect(row.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Deactivate" }),
  ).toHaveCount(0);

  // Edit opens the same form, prefilled from the row rather than blank.
  await row.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  const name = dialog.getByLabel("MCO supplier name");
  await expect(name).toHaveValue(LABEL);

  await name.fill(`${LABEL} renamed`);
  await dialog.getByRole("button", { name: "Save changes" }).click();

  // The form closes itself once the save is accepted, which is the signal
  // that the action finished. Reloading on the click alone races it — the
  // navigation can abort the request before it reaches the database.
  await expect(dialog).toBeHidden();

  await page.reload();

  // By cell, not by text: the name also appears in this row's own edit and
  // delete dialogs, which are in the DOM even while closed.
  const cell = page.getByRole("cell", { name: `${LABEL} renamed`, exact: true });
  await expect(cell).toBeVisible();

  // Delete asks for the name typed back; the button stays dead until it is.
  const renamed = page.getByRole("row", { name: new RegExp(E2E_TAG) });
  await renamed.getByRole("button", { name: "Delete" }).click();

  const confirm = page.getByRole("dialog");
  const submit = confirm.getByRole("button", { name: "Delete for good" });
  await expect(submit).toBeDisabled();

  await confirm.getByLabel(`Type ${LABEL} renamed below to confirm`).fill("wrong");
  await expect(submit).toBeDisabled();

  await confirm
    .getByLabel(`Type ${LABEL} renamed below to confirm`)
    .fill(`${LABEL} renamed`);
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(
    page.getByRole("cell", { name: `${LABEL} renamed`, exact: true }),
  ).toHaveCount(0);
});

test("an MCO supplier a booking uses offers Deactivate, not Delete", async ({
  page,
}) => {
  await signIn(page, superAdmin);
  await page.goto("/admin/mco-suppliers");

  // The seeded suppliers in the development database carry bookings. Any row
  // reporting a non-zero count must not offer a delete, because the foreign
  // key would refuse it.
  const inUse = page
    .getByRole("row")
    .filter({ hasNot: page.getByRole("columnheader") })
    .filter({ has: page.getByRole("button", { name: "Deactivate" }) });

  const count = await inUse.count();
  test.skip(count === 0, "No in-use MCO supplier in this database to assert on");

  const row = inUse.first();
  await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);

  await row.getByRole("button", { name: "Deactivate" }).click();
  const dialog = page.getByRole("dialog");

  // It says why, rather than leaving the operator to guess why Delete is gone.
  await expect(dialog).toContainText("cannot be deleted");
  await expect(dialog).toContainText("reference this MCO supplier");

  // No typed confirmation here: deactivating is reversible from Edit.
  await expect(
    dialog.getByRole("button", { name: "Deactivate" }),
  ).toBeEnabled();

  await dialog.getByRole("button", { name: "Cancel" }).click();
});
