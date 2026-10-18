import { expect, test } from "@playwright/test";

import {
  TEST_PASSWORD,
  cleanupFixtures,
  createTestUser,
  revokeSessions,
  setUserStatus,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Authentication and route protection, driven through the real browser.
 */

let operations: TestUser;

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "auth-ops");
});

test.afterAll(async () => {
  await cleanupFixtures();
});

test("an anonymous visitor is sent to sign in", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByText("Administrator sign in")).toBeVisible();
});

test("the root path redirects into the admin area", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("a wrong password is rejected without revealing whether the account exists", async ({
  page,
}) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email or username").fill(operations.email);
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  const signInError = page.locator("p[role='alert']");
  await expect(signInError).toBeVisible();
  const wrongPassword = await signInError.textContent();
  expect(wrongPassword).toContain("Invalid email or password");

  await page.goto("/admin/login");
  await page.getByLabel("Email or username").fill("nobody@example.invalid");
  await page.getByLabel("Password").fill("whatever");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Identical wording for both cases, so the form cannot be used to discover
  // which addresses are registered.
  await expect(signInError).toBeVisible();
  const unknownUser = await signInError.textContent();
  expect(unknownUser).toBe(wrongPassword);
});

test("valid credentials reach the dashboard", async ({ page }) => {
  await signIn(page, operations);

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("a signed-in administrator is bounced away from the sign-in page", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/login");

  await expect(page).toHaveURL(/\/admin$/);
});

test("signing out ends the session and protects the dashboard again", async ({
  page,
}) => {
  await signIn(page, operations);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/admin\/login/);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("a revoked session stops working immediately", async ({ page }) => {
  await signIn(page, operations);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // Simulates an administrator revoking access while the user is working.
  await revokeSessions(operations.id);

  await page.goto("/admin/bookings");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("a suspended account cannot sign in even with the right password", async ({
  page,
}) => {
  const suspended = await createTestUser("OPERATIONS", "auth-suspended");
  await setUserStatus(suspended.id, "SUSPENDED");

  await page.goto("/admin/login");
  await page.getByLabel("Email or username").fill(suspended.email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.locator("p[role='alert']")).toContainText(
    "Invalid email or password",
  );
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("a forged session cookie does not grant access", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "crm_session",
      value: "forged-token-that-was-never-issued",
      domain: "localhost",
      path: "/",
    },
  ]);

  await page.goto("/admin");

  // proxy.ts lets it past on cookie presence; the access layer rejects it.
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("the form reports missing fields rather than submitting", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email or username").fill("someone@example.invalid");
  // Password left empty.
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/admin\/login/);
});
