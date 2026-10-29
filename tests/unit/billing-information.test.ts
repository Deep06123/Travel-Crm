import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CardType } from "@/generated/prisma/enums";
import { billingInformationFields } from "@/features/bookings/schemas";

const schema = z.object(billingInformationFields);

/** MMYY a few years out, so these tests do not expire along with the card. */
function futureExpiry(yearsAhead = 3): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String((now.getFullYear() + yearsAhead) % 100).padStart(2, "0");
  return `${month}${year}`;
}

/** A card the schema accepts, so one field at a time can be made bad. */
const goodCard = {
  cardHolderName: "A Traveller",
  cardType: CardType.VISA,
  cardLast4: "1111",
  cardExpiry: futureExpiry(),
};

/**
 * The card number and CVV must not survive a round trip through the booking
 * form, whatever a caller posts. The form does not render a name for either
 * field, so nothing legitimate submits them; these tests guard the other end,
 * where a hand-rolled request could.
 */
describe("billing information never accepts card secrets", () => {
  it("strips a card number and CVV posted by hand", () => {
    const parsed = schema.parse({
      ...goodCard,
      // Neither of these is a field. Zod drops unknown keys, so they cannot
      // reach a Prisma create call through this schema.
      cardNumber: "4111111111111111",
      cvv: "123",
    });

    expect(parsed).not.toHaveProperty("cardNumber");
    expect(parsed).not.toHaveProperty("cvv");
    expect(Object.values(parsed)).not.toContain("4111111111111111");
    expect(parsed.cardLast4).toBe("1111");
  });

  it("defines no field that could hold a full card number", () => {
    const names = Object.keys(billingInformationFields).map((key) =>
      key.toLowerCase(),
    );

    expect(names).not.toContain("cardnumber");
    expect(names).not.toContain("cvv");
    expect(names).not.toContain("cvc");
    expect(names).not.toContain("pan");
  });
});

/**
 * A booking is not created without a card. The browser checks the number
 * itself; these are the four pieces that reach the server, and all four are
 * required — a submission missing any of them is rejected rather than saved
 * with a blank card.
 */
describe("the card is mandatory", () => {
  it("accepts a complete card", () => {
    expect(schema.safeParse(goodCard).success).toBe(true);
  });

  it("refuses a booking with no card at all", () => {
    const result = schema.safeParse({});

    expect(result.success).toBe(false);

    const fields = new Set(
      result.success ? [] : result.error.issues.map((issue) => issue.path[0]),
    );

    expect(fields).toContain("cardHolderName");
    expect(fields).toContain("cardType");
    expect(fields).toContain("cardLast4");
    expect(fields).toContain("cardExpiry");
  });

  it.each([
    "cardHolderName",
    "cardType",
    "cardLast4",
    "cardExpiry",
  ] as const)("refuses a card missing %s", (field) => {
    expect(schema.safeParse({ ...goodCard, [field]: "" }).success).toBe(false);
  });
});

describe("card last four", () => {
  it("accepts exactly four digits", () => {
    expect(schema.parse({ ...goodCard, cardLast4: "4242" }).cardLast4).toBe(
      "4242",
    );
  });

  it("refuses anything longer — a full number must not land here", () => {
    expect(
      schema.safeParse({ ...goodCard, cardLast4: "4111111111111111" }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...goodCard, cardLast4: "123" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...goodCard, cardLast4: "12a4" }).success).toBe(
      false,
    );
  });
});

describe("card expiry", () => {
  it("accepts a real month, in the future, as MMYY", () => {
    const expiry = futureExpiry();
    expect(schema.parse({ ...goodCard, cardExpiry: expiry }).cardExpiry).toBe(
      expiry,
    );
  });

  it("refuses a month that does not exist", () => {
    for (const bad of ["0028", "1328", "428", "04/28"]) {
      expect(schema.safeParse({ ...goodCard, cardExpiry: bad }).success).toBe(
        false,
      );
    }
  });

  it("refuses a card that has already expired", () => {
    expect(schema.safeParse({ ...goodCard, cardExpiry: "0120" }).success).toBe(
      false,
    );
  });
});

describe("billing email IDs", () => {
  it("accepts one address or a comma-separated list", () => {
    expect(
      schema.safeParse({ ...goodCard, billingEmails: "a@example.com" }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ...goodCard,
        billingEmails: "a@example.com, b@example.com",
      }).success,
    ).toBe(true);
  });

  it("refuses the list when any one address is malformed", () => {
    expect(
      schema.safeParse({
        ...goodCard,
        billingEmails: "a@example.com, not-an-email",
      }).success,
    ).toBe(false);
  });

  it("treats blank as absent rather than empty", () => {
    expect(
      schema.parse({ ...goodCard, billingEmails: "" }).billingEmails,
    ).toBeUndefined();
  });
});
