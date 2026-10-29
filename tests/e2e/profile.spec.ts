import { expect, test } from "@playwright/test";

import {
  cleanupFixtures,
  createTestUser,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * The signed-in administrator's own page.
 *
 * The account menu in the header had linked to `/admin/profile` since before
 * the route existed, so every page in the application prefetched a 404 and
 * clicking the link went nowhere. The prefetch is the part worth guarding:
 * it is invisible in the browser and only shows up in server logs.
 */

let operations: TestUser;
let readOnly: TestUser;

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "profile-ops");
  readOnly = await createTestUser("READ_ONLY", "profile-ro");
});

test.afterAll(async () => {
  await cleanupFixtures();
});

test("the account menu reaches the profile, and nothing 404s", async ({
  page,
}) => {
  const notFound: string[] = [];
  page.on("response", (response) => {
    if (response.status() === 404) notFound.push(response.url());
  });

  await signIn(page, operations);
  await page.goto("/admin/bookings");

  // Clicking the name in the header, as an operator would.
  await page.getByRole("link", { name: new RegExp(operations.name) }).click();
  await page.waitForURL(/\/admin\/profile$/);

  await expect(
    page.getByRole("heading", { name: operations.name, level: 1 }),
  ).toBeVisible();

  // The prefetch that was silently failing on every page load.
  expect(notFound.filter((url) => url.includes("/admin/profile"))).toEqual([]);
});

test("it shows the account, its sessions and what the role may do", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/profile");

  // Exact: the email also appears in the page header's subtitle.
  await expect(
    page.getByText(operations.email, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Operations").first()).toBeVisible();

  // The session this very request is being made on.
  await expect(page.getByText("This device", { exact: true })).toBeVisible();

  // Permissions come from the catalogue, so an operations role must show a
  // capability it holds and must not show one it does not.
  await expect(page.getByText("Create flight and cruise bookings")).toBeVisible();
  await expect(
    page.getByText("Permanently delete a booking created in error"),
  ).toHaveCount(0);

  await expect(
    page.getByRole("link", { name: "Change password" }),
  ).toBeVisible();
});

test("a read-only account sees its own, narrower list", async ({ page }) => {
  await signIn(page, readOnly);
  await page.goto("/admin/profile");

  await expect(page.getByText("View bookings and booking details")).toBeVisible();
  await expect(
    page.getByText("Create flight and cruise bookings"),
  ).toHaveCount(0);
});
