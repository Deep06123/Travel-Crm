import { expect, test } from "@playwright/test";

/**
 * Demo access, driven through a real browser.
 *
 * The point is not that a button exists but that pressing it lands on a working
 * dashboard with a real session — the permission-filtered sidebar is the proof,
 * since it is built from the signed-in role rather than rendered unconditionally.
 */
test("skip sign-in opens the full application", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("button", { name: /Skip sign-in/i })).toBeVisible();

  await page.getByRole("button", { name: /Skip sign-in/i }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // The shell's account link, not the dashboard subtitle, which also names the
  // signed-in administrator and would make a bare text match ambiguous.
  await expect(
    page.getByRole("link", { name: /Demo Administrator\s+SUPER_ADMIN/ }),
  ).toBeVisible();

  // SUPER_ADMIN sees Administration entries; a lesser role would not.
  await expect(page.getByRole("link", { name: "Audit Logs" })).toBeVisible();
});

test("a protected page is reachable after skipping", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByRole("button", { name: /Skip sign-in/i }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/bookings");
  await expect(page.getByRole("heading", { name: "All bookings" })).toBeVisible();
});
