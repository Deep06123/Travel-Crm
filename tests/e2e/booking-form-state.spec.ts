import { expect, test } from "@playwright/test";

import {
  cleanupFixtures,
  createTestCustomer,
  createTestUser,
  fillCardDetails,
  signIn,
  type TestCustomer,
  type TestUser,
} from "./fixtures";

/**
 * What the booking forms hold on to when a submission is rejected.
 *
 * React resets a `<form action={…}>` once the action settles. A reset restores
 * each control to its default: an `<input>` keeps what was typed, because
 * React keeps its value attribute in step with `defaultValue`, but a `<select>`
 * drops to its first option — React assigns `select.value` imperatively and
 * marks no `<option selected>` for the reset to find.
 *
 * So every rejected booking silently cleared Customer, Booking type, Supplier
 * and the rest while appearing to keep everything else. Customer is required,
 * which turned one missed field into "Select a customer." for a customer the
 * operator had already chosen.
 *
 * These drive the real forms because the bug lives in the interaction between
 * React's reset and the DOM. Nothing below it — not the schema, not the
 * action — ever saw a problem.
 */

let operations: TestUser;
let customer: TestCustomer;

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "formstate-ops");
  customer = await createTestCustomer();
});

test.afterAll(async () => {
  await cleanupFixtures();
});

test("a rejected flight booking keeps the selected customer", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/flight");

  // Every booking needs a card: the form will not submit without one.
  await fillCardDetails(page);

  const customerSelect = page.locator('select[name="customerId"]');
  const chargeSelect = page.locator('select[name="chargeOutcome"]');

  await customerSelect.selectOption(customer.id);
  await chargeSelect.selectOption("CHARGED");
  await page.locator('input[name="pnrLocator"]').fill("STATE1");

  // Rejected: no passenger has been named. The row itself is not empty — the
  // passenger-type select always carries a value — so the row is validated
  // and names the missing field rather than falling back to the generic
  // "Add at least one passenger."
  await page.getByRole("button", { name: "Create booking" }).click();
  await expect(page.locator("#passengers\\.0\\.firstName-error")).toHaveText(
    "Enter a first name.",
  );

  // The selects survive the reset, not just the text inputs.
  await expect(customerSelect).toHaveValue(customer.id);
  await expect(chargeSelect).toHaveValue("CHARGED");
  await expect(page.locator('input[name="pnrLocator"]')).toHaveValue("STATE1");

  // And the error is about what is actually missing — not about a customer
  // that was selected all along.
  await expect(page.getByText("Select a customer.")).toHaveCount(0);
});

test("a rejected cruise booking keeps the selected customer", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/cruise");

  // Every booking needs a card: the form will not submit without one.
  await fillCardDetails(page);

  const customerSelect = page.locator('select[name="customerId"]');

  await customerSelect.selectOption(customer.id);
  await page.locator('input[name="cruiseLine"]').fill("Royal Caribbean");
  await page.locator('input[name="guests.0.firstName"]').fill("Perpetua");
  await page.locator('input[name="guests.0.lastName"]').fill("E2EState");
  await page.locator('input[name="reservationNumber"]').fill("STATE2");

  // Rejected on the server rather than by the browser: a return before the
  // sailing passes every field's own rules and only fails the cross-field
  // check, which is exactly the case that reaches the action and resets.
  await page.locator('input[name="sailDate"]').fill("2027-11-09");
  await page.locator('input[name="returnDate"]').fill("2027-11-02");

  await page.getByRole("button", { name: "Create booking" }).click();
  await expect(page.locator("#returnDate-error")).toHaveText(
    "The return date cannot be before sailing.",
  );

  await expect(customerSelect).toHaveValue(customer.id);
  await expect(page.locator('input[name="reservationNumber"]')).toHaveValue(
    "STATE2",
  );
  await expect(page.getByText("Select a customer.")).toHaveCount(0);
});

test("correcting the rejected field creates the booking", async ({ page }) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/cruise");

  // Every booking needs a card: the form will not submit without one.
  await fillCardDetails(page);

  await page.locator('select[name="customerId"]').selectOption(customer.id);
  await page.locator('input[name="cruiseLine"]').fill("Royal Caribbean");
  await page.locator('input[name="guests.0.firstName"]').fill("Perpetua");
  await page.locator('input[name="guests.0.lastName"]').fill("E2EState");
  await page.locator('input[name="sailDate"]').fill("2027-11-09");
  await page.locator('input[name="returnDate"]').fill("2027-11-02");

  await page.getByRole("button", { name: "Create booking" }).click();
  await expect(page.locator("#returnDate-error")).toHaveText(
    "The return date cannot be before sailing.",
  );

  // The second attempt corrects only what was wrong. Before the fix this
  // failed again, on the customer, because the first attempt had cleared it.
  await page.locator('input[name="returnDate"]').fill("2027-11-16");
  await page.getByRole("button", { name: "Create booking" }).click();

  await page.waitForURL(/\/admin\/bookings\/[a-z0-9]+$/);
  await expect(
    page.getByRole("cell", { name: "Perpetua E2EState" }),
  ).toBeVisible();
});

test("the same reset guard holds outside the booking forms", async ({
  page,
}) => {
  await signIn(page, operations);

  // The customer form is the representative case for the rest of the
  // application: every `<form action>` in it now renders its selects through
  // the same component, so one form proving the behaviour proves the
  // mechanism. The duplicate warning is a convenient rejection — it comes back
  // from the action, which is what triggers React's reset.
  const email = `e2e-fixture-state-${Date.now()}@example.invalid`;

  const fill = async () => {
    await page.goto("/admin/customers/new");
    await page.getByLabel("First name").fill("Original");
    await page.getByLabel("Last name").fill("Person");
    await page.getByLabel("Email").fill(email);
    // Deliberately not the first option — the reset fell back to the first
    // one, so a default selection would hide the bug.
    await page.locator('select[name="status"]').selectOption("BLOCKED");
    await page.locator('select[name="preferredLanguage"]').selectOption("es");
    await page.getByRole("button", { name: "Create customer" }).click();
  };

  await fill();
  await page.waitForURL(/\/admin\/customers\/[a-z0-9]+$/);

  await fill();
  await expect(
    page.getByText("This may already be an existing customer"),
  ).toBeVisible();

  await expect(page.locator('select[name="status"]')).toHaveValue("BLOCKED");
  await expect(page.locator('select[name="preferredLanguage"]')).toHaveValue(
    "es",
  );
});
