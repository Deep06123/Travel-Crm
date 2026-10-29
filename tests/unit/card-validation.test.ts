import { describe, expect, it } from "vitest";

import { CardType } from "@/generated/prisma/enums";
import {
  type CardEntry,
  cvvLengthsFor,
  detectCardBrand,
  digitsOf,
  expiryHasPassed,
  expiryIsWellFormed,
  luhnValid,
  validateCardEntry,
} from "@/features/bookings/card-validation";

/**
 * The card number never reaches the server, so this module is the only place
 * a mis-keyed card is caught. These tests are the guarantee that it is.
 */

// Standard issuer test numbers — all Luhn-valid, none usable.
const VISA = "4111111111111111";
const VISA_13 = "4222222222222";
const MASTERCARD = "5555555555554444";
const MASTERCARD_2_SERIES = "2223003122003222";
const AMEX = "378282246310005";
const DISCOVER = "6011111111111117";
const DINERS = "30569309025904";
const JCB = "3530111333300000";

const FIXED_NOW = new Date("2026-10-29T12:00:00Z");

function entry(overrides: Partial<CardEntry> = {}): CardEntry {
  return {
    cardHolderName: "A Traveller",
    cardType: CardType.VISA,
    cardNumber: VISA,
    cardExpiry: "0428",
    cvv: "123",
    ...overrides,
  };
}

describe("digitsOf", () => {
  it("drops the spacing and dashes read off a card", () => {
    expect(digitsOf("4111 1111-1111 1111")).toBe(VISA);
    expect(digitsOf("")).toBe("");
  });
});

describe("luhnValid", () => {
  it("accepts every issuer test number", () => {
    for (const number of [
      VISA,
      VISA_13,
      MASTERCARD,
      MASTERCARD_2_SERIES,
      AMEX,
      DISCOVER,
      DINERS,
      JCB,
    ]) {
      expect(luhnValid(number), number).toBe(true);
    }
  });

  it("catches a single mis-keyed digit", () => {
    expect(luhnValid("4111111111111112")).toBe(false);
  });

  it("catches a transposition", () => {
    // The Discover test number ends 17; read back as 71 it no longer checks.
    expect(luhnValid(DISCOVER)).toBe(true);
    expect(luhnValid("6011111111111171")).toBe(false);
  });

  it("refuses anything that is not digits", () => {
    expect(luhnValid("")).toBe(false);
    expect(luhnValid("4111-1111-1111-1111")).toBe(false);
  });
});

describe("detectCardBrand", () => {
  it.each([
    [VISA, CardType.VISA],
    [VISA_13, CardType.VISA],
    [MASTERCARD, CardType.MASTERCARD],
    [MASTERCARD_2_SERIES, CardType.MASTERCARD],
    [AMEX, CardType.AMERICAN_EXPRESS],
    [DISCOVER, CardType.DISCOVER],
    [DINERS, CardType.DINERS_CLUB],
    [JCB, CardType.JCB],
  ])("reads %s as the right brand", (number, type) => {
    expect(detectCardBrand(number)?.type).toBe(type);
  });

  it("returns nothing for a prefix it does not know", () => {
    expect(detectCardBrand("9999999999999999")).toBeUndefined();
    expect(detectCardBrand("")).toBeUndefined();
  });
});

describe("cvvLengthsFor", () => {
  it("asks for four digits on Amex and three elsewhere", () => {
    expect(cvvLengthsFor(CardType.AMERICAN_EXPRESS)).toEqual([4]);
    expect(cvvLengthsFor(CardType.VISA)).toEqual([3]);
  });

  it("accepts either length when the brand is unknown", () => {
    expect(cvvLengthsFor(CardType.OTHER)).toEqual([3, 4]);
    expect(cvvLengthsFor("")).toEqual([3, 4]);
  });
});

describe("expiry", () => {
  it("accepts MMYY with a month that exists", () => {
    expect(expiryIsWellFormed("0428")).toBe(true);
    expect(expiryIsWellFormed("1230")).toBe(true);
    expect(expiryIsWellFormed("0028")).toBe(false);
    expect(expiryIsWellFormed("1328")).toBe(false);
    expect(expiryIsWellFormed("04/28")).toBe(false);
  });

  it("treats the expiry month itself as still good", () => {
    expect(expiryHasPassed("1026", FIXED_NOW)).toBe(false);
  });

  it("rejects the month before, and any earlier year", () => {
    expect(expiryHasPassed("0926", FIXED_NOW)).toBe(true);
    expect(expiryHasPassed("1225", FIXED_NOW)).toBe(true);
  });

  it("accepts a later month", () => {
    expect(expiryHasPassed("1126", FIXED_NOW)).toBe(false);
    expect(expiryHasPassed("0130", FIXED_NOW)).toBe(false);
  });
});

describe("validateCardEntry", () => {
  it("passes a well-formed card", () => {
    expect(validateCardEntry(entry(), FIXED_NOW)).toEqual({});
  });

  it("passes an Amex with a four-digit CVV", () => {
    expect(
      validateCardEntry(
        entry({
          cardNumber: AMEX,
          cardType: CardType.AMERICAN_EXPRESS,
          cvv: "1234",
        }),
        FIXED_NOW,
      ),
    ).toEqual({});
  });

  it("reports every empty field at once", () => {
    const errors = validateCardEntry(
      {
        cardHolderName: "",
        cardType: "",
        cardNumber: "",
        cardExpiry: "",
        cvv: "",
      },
      FIXED_NOW,
    );

    expect(Object.keys(errors).sort()).toEqual([
      "cardExpiry",
      "cardHolderName",
      "cardNumber",
      "cardType",
      "cvv",
    ]);
  });

  it("refuses a number that fails the check digit", () => {
    const errors = validateCardEntry(
      entry({ cardNumber: "4111111111111112" }),
      FIXED_NOW,
    );

    expect(errors.cardNumber).toMatch(/not valid/i);
  });

  it("refuses a number of the wrong length for its brand", () => {
    // Luhn-valid, but fifteen digits is not a Visa length.
    const errors = validateCardEntry(
      entry({ cardNumber: "411111111111117" }),
      FIXED_NOW,
    );

    expect(errors.cardNumber).toBeDefined();
  });

  it("refuses letters in the number", () => {
    expect(
      validateCardEntry(entry({ cardNumber: "4111 1111 1111 111x" }), FIXED_NOW)
        .cardNumber,
    ).toMatch(/digits only/i);
  });

  it("accepts a number typed with spaces and dashes", () => {
    expect(
      validateCardEntry(
        entry({ cardNumber: "4111 1111-1111 1111" }),
        FIXED_NOW,
      ),
    ).toEqual({});
  });

  it("flags a card type that disagrees with the number", () => {
    const errors = validateCardEntry(
      entry({ cardNumber: AMEX, cardType: CardType.VISA, cvv: "1234" }),
      FIXED_NOW,
    );

    expect(errors.cardType).toMatch(/American Express/);
    // The number itself is fine; only the selection is wrong.
    expect(errors.cardNumber).toBeUndefined();
  });

  it("lets Other stand for a brand the list does not know", () => {
    expect(
      validateCardEntry(
        entry({ cardNumber: AMEX, cardType: CardType.OTHER, cvv: "1234" }),
        FIXED_NOW,
      ),
    ).toEqual({});
  });

  it("takes the CVV length from the number, not the chosen type", () => {
    // Amex number with the type left on Visa: still four digits.
    const errors = validateCardEntry(
      entry({ cardNumber: AMEX, cardType: CardType.VISA, cvv: "123" }),
      FIXED_NOW,
    );

    expect(errors.cvv).toMatch(/4 digits/);
  });

  it("refuses a non-numeric CVV", () => {
    expect(validateCardEntry(entry({ cvv: "12a" }), FIXED_NOW).cvv).toMatch(
      /digits only/i,
    );
  });

  it("refuses an expired card", () => {
    expect(
      validateCardEntry(entry({ cardExpiry: "0926" }), FIXED_NOW).cardExpiry,
    ).toMatch(/expired/i);
  });

  it("refuses a malformed expiry", () => {
    expect(
      validateCardEntry(entry({ cardExpiry: "13/28" }), FIXED_NOW).cardExpiry,
    ).toMatch(/MMYY/);
  });

  it("refuses a one-character holder name", () => {
    expect(
      validateCardEntry(entry({ cardHolderName: "A" }), FIXED_NOW)
        .cardHolderName,
    ).toBeDefined();
  });
});
