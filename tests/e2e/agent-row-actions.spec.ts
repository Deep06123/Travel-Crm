import { expect, test } from "@playwright/test";

import {
  cleanupFixtures,
  createTestUser,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Removing an agent account from the list.
 *
 * Three behaviours worth proving in a browser, because all three are easy to
 * get wrong in a way that only shows up to a person clicking:
 *
 *   - The typed confirmation asks for the account's *name*, and says so
 *     legibly. An earlier wording ran the name into the sentence, so it read
 *     as "type something to confirm" and people typed "confirm" and met a
 *     button that stayed dead without explaining itself.
 *   - A never-used account is deleted for real and leaves the list.
 *   - An account that has done things offers Deactivate instead, because
 *     deleting it would reattribute its work to nobody.
 */

let superAdmin: TestUser;

test.beforeAll(async () => {
  superAdmin = await createTestUser("SUPER_ADMIN", "agent-admin");
});

test.afterAll(async () => {
  await cleanupFixtures();
});

/** Finds the row for one account by the email shown in it. */
function rowFor(page: import("@playwright/test").Page, email: string) {
  return page.getByRole("row").filter({ hasText: email });
}

test("an unused agent account is deleted once its name is typed back", async ({
  page,
}) => {
  const doomed = await createTestUser("OPERATIONS", "agent-doomed");

  // The list is the agent table, which only shows accounts with an Agent
  // profile — created through the form, so this one is created the same way.
  await signIn(page, superAdmin);
  await page.goto("/admin/agents");

  // By id rather than label: the page carries search filters whose labels
  // overlap the create form's, and the ids are stable and unique.
  await page.locator("#agent-name").fill(doomed.name);
  await page.locator("#agent-email").fill(`created-${doomed.email}`);
  await page.getByRole("button", { name: "Create agent" }).click();

  const row = rowFor(page, `created-${doomed.email}`);
  await expect(row).toBeVisible();

  // Never signed in and nothing recorded, so the control is a real delete.
  await row.getByRole("button", { name: "Delete" }).click();

  const dialog = page.getByRole("dialog");
  const submit = dialog.getByRole("button", { name: "Delete for good" });

  // Disabled until the name is typed — and the word being asked for is the
  // account's name, not the word "confirm".
  await expect(submit).toBeDisabled();

  await dialog.getByLabel(`Type ${doomed.name} below to confirm`).fill("confirm");
  await expect(submit).toBeDisabled();
  await expect(dialog.getByText("That does not match")).toBeVisible();

  await dialog
    .getByLabel(`Type ${doomed.name} below to confirm`)
    .fill(doomed.name);
  await expect(submit).toBeEnabled();

  await submit.click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(rowFor(page, `created-${doomed.email}`)).toHaveCount(0);
});

test("an agent who has done work offers Deactivate, not Delete", async ({
  page,
}) => {
  await signIn(page, superAdmin);
  await page.goto("/admin/agents");

  // Any account that has signed in or recorded work. Found rather than
  // created, because creating one means signing in as it — and the fork is
  // about what the list shows for an account with a history, whoever it is.
  const inUse = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: "Deactivate" }) });

  const count = await inUse.count();
  test.skip(count === 0, "No agent with recorded activity in this database");

  const row = inUse.first();

  // The guard that matters: deleting would reattribute their work to nobody,
  // so the control is not offered at all.
  await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);

  await row.getByRole("button", { name: "Deactivate" }).click();
  const dialog = page.getByRole("dialog");

  await expect(dialog).toContainText("signed out immediately");
  await expect(dialog).toContainText("attributed to it");

  // Reversible, so no typed confirmation stands in the way.
  await expect(
    dialog.getByRole("button", { name: "Deactivate account" }),
  ).toBeEnabled();

  // Cancelled: this is somebody's development account, and the assertion is
  // about which control is offered, not about switching it off.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});
