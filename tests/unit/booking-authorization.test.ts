import { describe, expect, it } from "vitest";

import { CardType } from "@/generated/prisma/enums";
import {
  renderBookingAuthorization,
  type BookingAuthorizationData,
} from "@/lib/mail/booking-authorization";

/**
 * The card authorization email.
 *
 * What is absent matters as much as what is present: this message goes to an
 * external mailbox and asks a cardholder to agree to a charge, so it must
 * carry the card's brand and last four digits and nothing more of the card,
 * and none of the internal figures the booking also holds.
 */

const LINK = {
  signUrl: "https://crm.example.com/sign/abc123",
  expiresAt: new Date("2026-11-14T00:00:00Z"),
};

const BASE: BookingAuthorizationData = {
  bookingNumber: "MV70065",
  customerName: "Gopinder Kumar",
  product: "FLIGHT",
  currency: "USD",
  totalMinor: 12_300,
  travelStartDate: new Date("2027-01-10T00:00:00Z"),
  airlineConfirmation: "SDFDSFSD",
  supportPhone: "+1-888-480-7222",
  segments: [
    {
      airline: "Gopinder Airline",
      flightNumber: "GA101",
      origin: "JFK",
      destination: "LHR",
      departureAt: new Date("2027-01-10T18:00:00Z"),
      arrivalAt: new Date("2027-01-11T06:00:00Z"),
    },
  ],
  cruise: null,
  passengers: [
    {
      firstName: "Gopinder",
      lastName: "Kumar",
      gender: "Male",
      dateOfBirth: new Date("2026-01-12T00:00:00Z"),
      ticketNumber: "1234567890",
    },
  ],
  bookedAt: new Date("2026-10-31T12:00:00Z"),
  contactEmail: "gopinderanand@example.com",
  contactPhone: "1234555",
  cardHolderName: "Gopinder Kumar",
  cardType: CardType.VISA,
  cardLast4: "1111",
  billingAddress: "12 Example Street, Leeds, LS1 1AA, United Kingdom",
  chargeSplits: [],
};

describe("renderBookingAuthorization", () => {
  it("addresses the customer and names the booking", () => {
    const { html, subject } = renderBookingAuthorization(BASE, LINK);

    expect(subject).toBe("Please confirm your booking — MV70065");
    expect(html).toContain("Dear Gopinder Kumar,");
    expect(html).toContain("MV70065");
    expect(html).toContain("SDFDSFSD");
  });

  it("links the confirm button at the signing URL", () => {
    const { html, text } = renderBookingAuthorization(BASE, LINK);

    expect(html).toContain(`href="${LINK.signUrl}"`);
    expect(html).toContain("CLICK TO CONFIRM");
    // A text-only client must be able to follow it too.
    expect(text).toContain(LINK.signUrl);
  });

  it("tells the customer when the link stops working", () => {
    const { html, text } = renderBookingAuthorization(BASE, LINK);

    expect(html).toContain("14-11-2026");
    expect(text).toContain("14-11-2026");
  });

  it("shows only the card's brand and last four digits", () => {
    const { html } = renderBookingAuthorization(BASE, LINK);

    expect(html).toContain("Visa (****1111)");
    expect(html).toContain("Card holder name");
    // There is no column for a PAN, so there must be no sign of one.
    expect(html).not.toContain("4111111111111111");
  });

  it("omits the card line entirely when the booking has no card", () => {
    const { html } = renderBookingAuthorization(
      { ...BASE, cardType: null, cardLast4: null },
      LINK,
    );

    expect(html).toContain("Credit Card Authorization Details");
    expect(html).not.toContain("Payment method");
    expect(html).not.toContain("****");
  });

  it("states a single charge when the total is not split", () => {
    const { html, text } = renderBookingAuthorization(BASE, LINK);

    expect(html).toContain("$123.00");
    expect(text).toContain("will be charged as a single transaction");
  });

  it("itemises the splits when the total is taken in parts", () => {
    const { html, text } = renderBookingAuthorization(
      {
        ...BASE,
        chargeSplits: [
          { title: "Deposit", amountMinor: 5_000 },
          { title: "Balance", amountMinor: 7_300 },
        ],
      },
      LINK,
    );

    expect(html).toContain("Deposit: $50.00");
    expect(html).toContain("Balance: $73.00");
    expect(text).toContain("may be charged in more than one transaction");
    expect(text).toContain("The sum charged will be the same as the total");
  });

  it("carries the acknowledgement the signature is given against", () => {
    const { html, text } = renderBookingAuthorization(BASE, LINK);

    expect(html).toContain("I acknowledge receipt of this email");
    expect(text).toContain("I acknowledge receipt of this email");
  });

  it("escapes customer-supplied text rather than interpolating markup", () => {
    const { html } = renderBookingAuthorization(
      { ...BASE, customerName: 'Ann <script>alert("x")</script>' },
      LINK,
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("labels a cruise as a cruise", () => {
    const { html } = renderBookingAuthorization(
      { ...BASE, product: "CRUISE" },
      LINK,
    );

    expect(html).toContain("Total cruise booking amount");
    expect(html).toContain("Cruise Rules and Restrictions");
    // A cruise has no e-ticket number column on the traveller table.
    expect(html).not.toContain("E-Ticket No.");
  });

  it("honours the booking's custom subject override", () => {
    const { subject } = renderBookingAuthorization(
      { ...BASE, customEmailSubject: "Action needed on your trip" },
      LINK,
    );

    expect(subject).toBe("Action needed on your trip");
  });
});
