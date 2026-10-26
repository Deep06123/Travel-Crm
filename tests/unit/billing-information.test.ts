import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CardType } from "@/generated/prisma/enums";
import { billingInformationFields } from "@/features/bookings/schemas";

const schema = z.object(billingInformationFields);

/**
 * The card number and CVV must not survive a round trip through the booking
 * form, whatever a caller posts. The form does not render a name for either
 * field, so nothing legitimate submits them; these tests guard the other end,
 * where a hand-rolled request could.
 */
describe("billing information never accepts card secrets", () => {
  it("strips a card number and CVV posted by hand", () => {
    const parsed = schema.parse({
      cardHolderName: "A Traveller",
      cardType: CardType.VISA,
      cardLast4: "1111",
      cardExpiry: "0428",
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

describe("card last four", () => {
  it("accepts exactly four digits, or nothing", () => {
    expect(schema.parse({ cardLast4: "4242" }).cardLast4).toBe("4242");
    expect(schema.parse({ cardLast4: "" }).cardLast4).toBeUndefined();
    expect(schema.parse({}).cardLast4).toBeUndefined();
  });

  it("refuses anything longer — a full number must not land here", () => {
    expect(schema.safeParse({ cardLast4: "4111111111111111" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ cardLast4: "123" }).success).toBe(false);
    expect(schema.safeParse({ cardLast4: "12a4" }).success).toBe(false);
  });
});

describe("card expiry", () => {
  it("accepts a real month as MMYY", () => {
    expect(schema.parse({ cardExpiry: "0428" }).cardExpiry).toBe("0428");
    expect(schema.parse({ cardExpiry: "1230" }).cardExpiry).toBe("1230");
    expect(schema.parse({ cardExpiry: "" }).cardExpiry).toBeUndefined();
  });

  it("refuses a month that does not exist", () => {
    expect(schema.safeParse({ cardExpiry: "0028" }).success).toBe(false);
    expect(schema.safeParse({ cardExpiry: "1328" }).success).toBe(false);
    expect(schema.safeParse({ cardExpiry: "428" }).success).toBe(false);
    expect(schema.safeParse({ cardExpiry: "04/28" }).success).toBe(false);
  });
});

describe("billing email IDs", () => {
  it("accepts one address or a comma-separated list", () => {
    expect(schema.safeParse({ billingEmails: "a@example.com" }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({ billingEmails: "a@example.com, b@example.com" })
        .success,
    ).toBe(true);
  });

  it("refuses the list when any one address is malformed", () => {
    expect(
      schema.safeParse({ billingEmails: "a@example.com, not-an-email" })
        .success,
    ).toBe(false);
  });

  it("treats blank as absent rather than empty", () => {
    expect(schema.parse({ billingEmails: "" }).billingEmails).toBeUndefined();
  });
});
