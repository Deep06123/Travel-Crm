import { expect, test } from "@playwright/test";

/**
 * Demo access, driven through a real browser.
 *
 * With DEMO_MODE on there is no sign-in step at all: the access layer resolves
 * a fixed demo administrator without consulting a stored session, so the login
 * page has nobody to ask for credentials and sends the visitor straight in.
 *
 * Every assertion below is made with **no cookie**, deliberately. That is what
 * distinguishes this from a signed-in session: a serverless deployment answers
 * each request from whichever instance is free, and each instance holds its own
 * copy of the embedded database. Anything that depended on state written during
 * an earlier request would work only until the visitor landed somewhere else.
 */

test("the root opens the application without a sign-in", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

  // The shell's account link, not the dashboard subtitle, which also names the
  // signed-in administrator and would make a bare text match ambiguous.
  await expect(
    page.getByRole("link", { name: /Demo Administrator\s+SUPER_ADMIN/ }),
  ).toBeVisible();
});

test("the login page has nobody to sign in and redirects", async ({ page }) => {
  await page.goto("/admin/login");

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
});

test("the sidebar is built from the resolved role", async ({ page }) => {
  await page.goto("/admin");

  // Administration entries are permission-gated: their presence shows the
  // grants were seeded and resolved, not that the sidebar renders regardless.
  await expect(page.getByRole("link", { name: "Audit Logs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
});

/**
 * Each page is opened in a fresh context, so none of them inherit a cookie
 * from a previous test. A page that only worked once something had been
 * written on an earlier request would fail here.
 */
for (const [path, heading] of [
  ["/admin/bookings", "All bookings"],
  ["/admin/customers", "Customers"],
  ["/admin/payments", "Payments"],
  ["/admin/refunds", "Refunds & voids"],
  ["/admin/documents", "Documents"],
  ["/admin/audit-logs", "Audit logs"],
  ["/admin/reports/financial", "Financial report"],
] as const) {
  test(`${path} loads with no cookie`, async ({ page }) => {
    await page.goto(path);
    // level 1 specifically: sidebar group labels are headings too, and
    // "Customers" is both a section label and a page title.
    await expect(
      page.getByRole("heading", { name: heading, level: 1 }),
    ).toBeVisible();
  });
}
