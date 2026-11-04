import { expect, test, type Page } from "@playwright/test";

import {
  cleanupFixtures,
  createTestUser,
  readBusinessSetting,
  signIn,
  writeBusinessSetting,
  type TestUser,
} from "./fixtures";

/**
 * Configuring who is copied when a customer email goes out.
 *
 * Worth a browser test rather than only a service test, because what can break
 * here is what the service never sees: whether the form posts at all, whether
 * a typo is reported instead of silently stored, whether what comes back is
 * what will actually be emailed, and whether a role without settings access is
 * kept away from it.
 *
 * Unlike every other fixture in this suite, the row under test belongs to the
 * installation rather than to the spec — there is one of it, and an operator
 * running the suite has their own value in it. It is therefore read directly
 * before the run and written straight back afterwards, in `afterAll` rather
 * than at the end of a test, so a failure half-way cannot leave somebody's
 * notifications pointed at `owner@example.invalid`.
 */

const KEY = "admin_notification_emails";
const FIELD = "Notification addresses";

let superAdmin: TestUser;
let readOnly: TestUser;
let original: string | null = null;

test.beforeAll(async () => {
  original = await readBusinessSetting(KEY);
  superAdmin = await createTestUser("SUPER_ADMIN", "notify-admin");
  readOnly = await createTestUser("READ_ONLY", "notify-readonly");
});

test.afterAll(async () => {
  await writeBusinessSetting(KEY, original);
  await cleanupFixtures();
});

/**
 * Fills the box and proves it took.
 *
 * The textarea is a controlled React component, so a `fill()` that lands
 * before hydration is reverted by the first client render — and the next
 * submit posts whatever is left, which is how an earlier version of this spec
 * saved three addresses run together as one. Retrying the fill until the value
 * sticks is the honest fix: it waits for the page to be interactive instead of
 * assuming it.
 */
async function setAddresses(page: Page, value: string): Promise<void> {
  const field = page.getByLabel(FIELD);

  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }).toPass({ timeout: 15_000 });
}

async function save(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save addresses" }).click();
}

test("a super admin sets, corrects and clears the notification addresses", async ({
  page,
}) => {
  await signIn(page, superAdmin);
  await page.goto("/admin/settings");

  await expect(page.getByLabel(FIELD)).toBeVisible();

  // A typo is reported, not stored. This is the failure that would otherwise
  // go unnoticed until somebody realised they had stopped being copied.
  await setAddresses(page, "not an address");
  await save(page);
  // Scoped to the form: Next's route announcer is also `role="alert"`.
  await expect(page.locator('form p[role="alert"]')).toContainText(
    "not an email address",
  );

  // Nothing was written for a rejected save.
  expect(await readBusinessSetting(KEY)).toBe(original);

  // The repeat and the stray spacing are dropped, so what comes back is what
  // will actually be emailed.
  await setAddresses(
    page,
    "owner@example.invalid\n  OWNER@example.invalid \ndesk@example.invalid",
  );
  await save(page);

  const saved = page.getByRole("status");
  await expect(saved).toContainText("owner@example.invalid");
  await expect(saved).toContainText("desk@example.invalid");
  await expect(page.getByText("2 addresses")).toBeVisible();

  // Stored, not merely echoed back: a reload reads the row out again.
  await page.reload();
  await expect(page.getByLabel(FIELD)).toHaveValue(
    "owner@example.invalid\ndesk@example.invalid",
  );

  // Emptying the box is how notifications are turned off.
  await setAddresses(page, "");
  await save(page);
  await expect(page.getByRole("status")).toContainText("Nobody will be copied");

  await page.reload();
  await expect(page.getByLabel(FIELD)).toHaveValue("");

  // Off is the absence of the row, not a row holding an empty list.
  expect(await readBusinessSetting(KEY)).toBeNull();
});

test("a role without settings access cannot reach the addresses at all", async ({
  page,
}) => {
  await signIn(page, readOnly);

  const response = await page.goto("/admin/settings");

  // `settings.view` is held by SUPER_ADMIN alone under the default grants, so
  // the whole page is refused rather than the form being hidden on it. 403,
  // not 500: a denial is not a server fault.
  expect(response?.status()).toBe(403);
  await expect(page.getByLabel(FIELD)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save addresses" }),
  ).toHaveCount(0);
});
