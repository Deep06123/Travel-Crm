import { expect, test, type Page } from "@playwright/test";

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
 * No booking is created without a card that checks out.
 *
 * The card number and CVV are never submitted — see `billing-information.tsx`
 * — so the check that a number is well-formed can only happen in the browser,
 * before the action runs. That makes these browser tests the only place the
 * rule can be proved: a unit test can show `validateCardEntry` returns an
 * error, but not that the form refused to submit because of it.
 *
 * Every number below is a standard issuer test number or a deliberate
 * mis-key of one. None of them is a card.
 */

let operations: TestUser;
let customer: TestCustomer;

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "cardcheck-ops");
  customer = await createTestCustomer();
});

test.afterAll(async () => {
  await cleanupFixtures();
});

/** Everything a flight booking needs apart from the card. */
async function openFlightForm(page: Page) {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/flight");

  await page.locator('select[name="customerId"]').selectOption(customer.id);
  await page.locator('input[name="passengers.0.firstName"]').fill("Aster");
  await page.locator('input[name="passengers.0.lastName"]').fill("E2ECard");
}

test("a mis-keyed card number does not create the booking", async ({
  page,
}) => {
  await openFlightForm(page);

  // The Visa test number with its last digit changed: right length, right
  // brand, fails the check digit.
  await fillCardDetails(page, { number: "4111111111111112" });

  await page.getByRole("button", { name: "Create booking" }).click();

  await expect(page.locator("#cardNumber-error")).toContainText("not valid");
  await expect(page).toHaveURL(/\/admin\/bookings\/new\/flight$/);
  await expect(page.locator("#cardNumber")).toBeFocused();
});

test("an expired card does not create the booking", async ({ page }) => {
  await openFlightForm(page);
  await fillCardDetails(page, { expiry: "0120" });

  await page.getByRole("button", { name: "Create booking" }).click();

  await expect(page.locator("#cardExpiry-error")).toContainText("expired");
  await expect(page).toHaveURL(/\/admin\/bookings\/new\/flight$/);
});

test("a card type that disagrees with the number does not create the booking", async ({
  page,
}) => {
  await openFlightForm(page);

  // An American Express number filed under Visa.
  await fillCardDetails(page, {
    number: "378282246310005",
    type: "VISA",
    cvv: "1234",
  });

  await page.getByRole("button", { name: "Create booking" }).click();

  await expect(page.locator("#cardType-error")).toContainText(
    "American Express",
  );
  await expect(page).toHaveURL(/\/admin\/bookings\/new\/flight$/);
});

test("the CVV length follows the card, not the chosen type", async ({
  page,
}) => {
  await openFlightForm(page);

  // Amex wants four digits; three is correct for everything else.
  await fillCardDetails(page, {
    number: "378282246310005",
    type: "AMERICAN_EXPRESS",
    cvv: "123",
  });

  await page.getByRole("button", { name: "Create booking" }).click();

  await expect(page.locator("#cvv-error")).toContainText("4 digits");
  await expect(page).toHaveURL(/\/admin\/bookings\/new\/flight$/);

  // Four digits and the same booking goes through.
  await page.locator("#cvv").fill("1234");
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/admin\/bookings\/[a-z0-9]+$/);
});

test("a booking with no card at all is refused", async ({ page }) => {
  await openFlightForm(page);

  // Everything else is in order; the billing panel is left untouched.
  await page.getByRole("button", { name: "Create booking" }).click();

  await expect(page.locator("#cardHolderName-error")).toContainText(
    "Enter the card holder name.",
  );
  await expect(page.locator("#cardNumber-error")).toContainText(
    "Enter the card number.",
  );
  await expect(page.locator("#cardExpiry-error")).toContainText(
    "Enter the expiry date.",
  );
  await expect(page.locator("#cvv-error")).toContainText("Enter the CVV.");
  await expect(page).toHaveURL(/\/admin\/bookings\/new\/flight$/);
});

test("a good card creates the booking and keeps only its last four", async ({
  page,
}) => {
  await openFlightForm(page);
  await fillCardDetails(page, { number: "4111 1111 1111 1111" });

  // Derived in the browser while typing — the number itself is never sent.
  await expect(page.locator('input[name="cardLast4"]')).toHaveValue("1111");

  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/admin\/bookings\/[a-z0-9]+$/);

  // The saved booking shows the brand and the last four, and nothing more.
  await page
    .getByRole("button", { name: "Expand Billing information" })
    .click();
  await expect(page.getByText("Visa ····1111")).toBeVisible();
  await expect(page.getByText("4111111111111111")).toHaveCount(0);
});

test("a cruise booking is held to the same card rules", async ({ page }) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/cruise");

  await page.locator('select[name="customerId"]').selectOption(customer.id);
  await page.locator('input[name="cruiseLine"]').fill("Royal Caribbean");
  await page.locator('input[name="guests.0.firstName"]').fill("Perpetua");
  await page.locator('input[name="guests.0.lastName"]').fill("E2ECard");

  await fillCardDetails(page, { number: "4111111111111112" });
  await page.getByRole("button", { name: "Create booking" }).click();

  await expect(page.locator("#cardNumber-error")).toContainText("not valid");
  await expect(page).toHaveURL(/\/admin\/bookings\/new\/cruise$/);

  await fillCardDetails(page);
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/admin\/bookings\/[a-z0-9]+$/);
});

test("a valid number is not called invalid while it is being typed", async ({
  page,
}) => {
  await openFlightForm(page);

  const number = page.locator("#cardNumber");
  const error = page.locator("#cardNumber-error");

  // Leave the field once with something incomplete. From here on the field is
  // "touched", which is what used to make every later keystroke a verdict.
  await number.fill("4242");
  await number.blur();
  await expect(error).toBeVisible();

  // Now type a perfectly good Visa, a digit at a time. Nothing should be
  // called invalid along the way: a number in progress is not a wrong number.
  await number.click();
  await number.fill("");
  for (const digit of "4242424242424242") {
    await number.pressSequentially(digit);
    await expect(error).toBeHidden();
  }

  // And on leaving, the completed number is accepted.
  await number.blur();
  await expect(error).toBeHidden();
});

test("leaving a genuinely bad number still reports it", async ({ page }) => {
  await openFlightForm(page);

  const number = page.locator("#cardNumber");
  const error = page.locator("#cardNumber-error");

  // One digit off a real test number: Luhn catches it.
  await number.fill("4242424242424243");
  await expect(error).toBeHidden();

  await number.blur();
  await expect(error).toContainText("check it and re-enter it");
});
