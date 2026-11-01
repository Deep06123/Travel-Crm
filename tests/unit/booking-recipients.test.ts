import { describe, expect, it } from "vitest";

import {
  bookingRecipientLine,
  bookingRecipients,
} from "@/lib/bookings/recipients";

/**
 * Where a booking's customer mail goes.
 *
 * Worth testing directly rather than through a send: this decides which
 * inboxes receive the authorization link, and that link is a bearer token.
 */

function booking(
  overrides: Partial<{
    contactEmail: string | null;
    billingEmails: string | null;
    customerEmail: string | null;
  }> = {},
) {
  return {
    contactEmail: overrides.contactEmail ?? null,
    billingEmails: overrides.billingEmails ?? null,
    customer: { email: overrides.customerEmail ?? null },
  };
}

describe("bookingRecipients", () => {
  it("prefers the billing Email IDs over every other address", () => {
    expect(
      bookingRecipients(
        booking({
          billingEmails: "billing@example.com",
          contactEmail: "contact@example.com",
          customerEmail: "customer@example.com",
        }),
      ),
    ).toEqual(["billing@example.com"]);
  });

  it("returns every address in the list, in the order entered", () => {
    expect(
      bookingRecipients(
        booking({ billingEmails: "one@example.com, two@example.com" }),
      ),
    ).toEqual(["one@example.com", "two@example.com"]);
  });

  it("ignores blank entries from a trailing or doubled comma", () => {
    expect(
      bookingRecipients(
        booking({ billingEmails: "one@example.com,, two@example.com, " }),
      ),
    ).toEqual(["one@example.com", "two@example.com"]);
  });

  it("does not send the same person two copies", () => {
    expect(
      bookingRecipients(
        booking({ billingEmails: "One@Example.com, one@example.com" }),
      ),
    ).toEqual(["One@Example.com"]);
  });

  it("falls back to the booking's contact address", () => {
    expect(
      bookingRecipients(
        booking({
          billingEmails: "   ",
          contactEmail: "contact@example.com",
          customerEmail: "customer@example.com",
        }),
      ),
    ).toEqual(["contact@example.com"]);
  });

  it("falls back to the customer record last", () => {
    expect(
      bookingRecipients(booking({ customerEmail: "customer@example.com" })),
    ).toEqual(["customer@example.com"]);
  });

  it("is empty when the booking has nowhere to send to", () => {
    expect(bookingRecipients(booking())).toEqual([]);
    expect(bookingRecipientLine(booking())).toBe("");
  });

  it("joins the list as one header value", () => {
    expect(
      bookingRecipientLine(
        booking({ billingEmails: "one@example.com,two@example.com" }),
      ),
    ).toBe("one@example.com, two@example.com");
  });
});
