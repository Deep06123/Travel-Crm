import { describe, expect, it } from "vitest";

import { renderETicket } from "@/lib/mail/eticket";
import {
  renderBookingConfirmed,
  renderBookingTicketed,
  type BookingEmailData,
} from "@/lib/mail/templates";

/**
 * The e-ticket document.
 *
 * The same renderer produces the customer's email body and the page staff open
 * to check it, so these assertions cover both at once — which is the reason it
 * is one function rather than two that have to be kept in step.
 */

const BASE: BookingEmailData = {
  bookingNumber: "BK-2026-0042",
  customerName: "gopinder kumar",
  product: "FLIGHT",
  currency: "USD",
  totalMinor: 248_000,
  travelStartDate: new Date("2027-01-10T00:00:00Z"),
  airlineConfirmation: "6QX4LM",
  policyOverrides: {},
  supportPhone: "+1-888-480-7222",
  cardHolderName: "GOPINDER KUMAR",
  cardType: "VISA",
  cardLast4: "1111",
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
      firstName: "gopinder",
      lastName: "kumar",
      gender: "Male",
      dateOfBirth: new Date("2025-01-09T00:00:00Z"),
      ticketNumber: "123456",
    },
  ],
};

const CONFIRMED = "YOUR RESERVATION IS CONFIRMED!!";

describe("renderETicket", () => {
  it("addresses the customer and names the carrier", () => {
    const html = renderETicket(BASE, CONFIRMED, "Thank you for booking with us.");

    expect(html).toContain("Dear gopinder kumar,");
    expect(html).toContain("Greetings for the day!");
    expect(html).toContain("GOPINDER AIRLINE");
  });

  it("shows the support number from the booking's TFN", () => {
    const html = renderETicket(BASE, CONFIRMED, "x");

    expect(html).toContain("Call us 24/7");
    expect(html).toContain("+1-888-480-7222");
  });

  it("lists each traveller with gender, date of birth and ticket number", () => {
    const html = renderETicket(BASE, CONFIRMED, "x");

    expect(html).toContain("gopinder kumar");
    expect(html).toContain("Male");
    expect(html).toContain("09-01-2025");
    expect(html).toContain("123456");
  });

  it("masks the date of birth when asked, keeping everything else", () => {
    const html = renderETicket(BASE, CONFIRMED, "x", {
      redactDateOfBirth: true,
    });

    expect(html).not.toContain("09-01-2025");
    expect(html).toContain("••••••••••");
    // Redaction is about the date alone; the rest of the row still identifies
    // the traveller, which is the point of previewing it.
    expect(html).toContain("gopinder kumar");
    expect(html).toContain("123456");
  });

  it("falls back to the booking reference when the carrier confirmed nothing", () => {
    const html = renderETicket(
      { ...BASE, airlineConfirmation: null },
      CONFIRMED,
      "x",
    );

    expect(html).toContain("BK-2026-0042");
  });

  it("escapes a name rather than letting it inject markup", () => {
    const html = renderETicket(
      { ...BASE, customerName: '<img src=x onerror="alert(1)">' },
      CONFIRMED,
      "x",
    );

    // The word survives as escaped text, which is the correct outcome: it is
    // displayed rather than parsed. What must not survive is a real tag.
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&quot;");
  });

  it("drops the e-ticket column for a cruise, which issues no air ticket", () => {
    const html = renderETicket(
      {
        ...BASE,
        product: "CRUISE",
        segments: [],
        cruise: {
          cruiseLine: "Royal Caribbean",
          ship: "Symphony",
          departurePort: "Miami",
          sailDate: new Date("2027-05-01T00:00:00Z"),
          returnDate: new Date("2027-05-08T00:00:00Z"),
          nights: 7,
        },
      },
      CONFIRMED,
      "x",
    );

    expect(html).not.toContain("E-Ticket No.");
    expect(html).toContain("sail with");
    expect(html).toContain("ROYAL CARIBBEAN");
  });

  /**
   * The terms at the foot of the document.
   *
   * The e-ticket is the message a customer still has months later, when a
   * change fee or a no-show is being argued about, so it carries the same
   * rules the authorization email stated.
   */
  it("prints the policy sections at the foot of the document", () => {
    const html = renderETicket(BASE, CONFIRMED, "x");

    expect(html).toContain("Booking Policy");
    expect(html).toContain("Change Rules");
    expect(html).toContain("Flight Rules and Restrictions");
    expect(html).toContain("No refunds are provided in the case of a no-show.");
    expect(html).toContain("We are open 24x7");
  });

  /**
   * The customer is holding the e-ticket while they read this, so the terms
   * cannot promise to send them one.
   */
  it("writes the stage-dependent lines for a document already issued", () => {
    const html = renderETicket(BASE, CONFIRMED, "x");

    expect(html).toContain("Your card was charged only after we received");
    expect(html).toContain(
      "Your e-tickets and carrier confirmation are set out in this email.",
    );
    expect(html).toContain("It is your e-ticket receipt.");

    expect(html).not.toContain("will receive your e-tickets");
    expect(html).not.toContain("the e-ticket receipt will be sent shortly");
    expect(html).not.toContain("Cards will be charged only after");
    expect(html).not.toContain("within 24 hours of making this reservation");
  });

  it("titles the last policy section for the product", () => {
    const html = renderETicket(
      {
        ...BASE,
        product: "CRUISE",
        segments: [],
        cruise: {
          cruiseLine: "Royal Caribbean",
          ship: "Wonder of the Seas",
          departurePort: "Miami",
          sailDate: new Date("2027-03-01T00:00:00Z"),
          returnDate: new Date("2027-03-08T00:00:00Z"),
          nights: 7,
        },
      },
      CONFIRMED,
      "x",
    );

    expect(html).toContain("Cruise Rules and Restrictions");
    expect(html).not.toContain("Flight Rules and Restrictions");
  });

  it("omits the call-us line when the booking has no support number", () => {
    const html = renderETicket({ ...BASE, supportPhone: null }, CONFIRMED, "x");

    expect(html).toContain("Booking Policy");
    expect(html).not.toContain("We are open 24x7");
  });

  it("names the card the booking was charged to, last four digits only", () => {
    const html = renderETicket(BASE, CONFIRMED, "x");

    expect(html).toContain("Card holder");
    expect(html).toContain("GOPINDER KUMAR");
    expect(html).toContain("Payment method");
    expect(html).toContain("Visa (****1111)");
  });

  it("shows the card on a cruise document too", () => {
    const html = renderETicket(
      {
        ...BASE,
        product: "CRUISE",
        segments: [],
        cruise: {
          cruiseLine: "Royal Caribbean",
          ship: "Symphony",
          departurePort: "Miami",
          sailDate: new Date("2027-05-01T00:00:00Z"),
          returnDate: new Date("2027-05-08T00:00:00Z"),
          nights: 7,
        },
        cardHolderName: "A TRAVELLER",
      },
      CONFIRMED,
      "x",
    );

    expect(html).toContain("A TRAVELLER");
    expect(html).toContain("Visa (****1111)");
  });

  /**
   * The database holds no PAN and no CVV (`schema.prisma`: the number is
   * discarded in the browser and never submitted), so there is nothing for a
   * renderer to leak by accident. This asserts the document carries no more of
   * a card than the four digits — the check that would fail first if a full
   * number were ever added to the model and then rendered here.
   */
  it("prints no card digits beyond the last four", () => {
    const html = renderETicket(BASE, CONFIRMED, "x");

    // Nothing PAN-shaped anywhere in the document. Deliberately 13-19 rather
    // than "any long run": the markup is full of innocent digit runs — hex
    // colours are six, the total is six — and a check that trips on those
    // gets loosened by whoever hits it next until it means nothing.
    expect(html).not.toMatch(/\d{13,19}/);
    // The mask is the only form the card takes.
    expect(html).toContain("Visa (****1111)");
    expect(html).not.toContain("4111111111111111");
  });

  it("omits both card rows rather than emptying them when there is no card", () => {
    const html = renderETicket(
      { ...BASE, cardHolderName: null, cardType: null, cardLast4: null },
      CONFIRMED,
      "x",
    );

    expect(html).not.toContain("Card holder");
    expect(html).not.toContain("Payment method");
    // The rest of the booking block is untouched.
    expect(html).toContain("Booking reference");
  });
});

describe("the emails use the same document", () => {
  it("the confirmation email body is the e-ticket", () => {
    const mail = renderBookingConfirmed(BASE);

    expect(mail.html).toContain("Dear gopinder kumar,");
    expect(mail.html).toContain(CONFIRMED);
    expect(mail.html).toContain("Traveler Details");
  });

  it("the ticketed email body is the e-ticket", () => {
    const mail = renderBookingTicketed(BASE);

    expect(mail.html).toContain("YOUR E-TICKET IS ISSUED!!");
    expect(mail.html).toContain("Traveler Details");
  });

  it("the top-heading override replaces the status line", () => {
    const mail = renderBookingConfirmed({
      ...BASE,
      emailTopHeading: "Welcome aboard, Priya",
    });

    expect(mail.html).toContain("Welcome aboard, Priya");
    expect(mail.html).not.toContain(CONFIRMED);
  });

  it("prints the itinerary after the booking details", () => {
    const mail = renderBookingTicketed({
      ...BASE,
      itineraryHtml: '<p>Gate closes 30 min before</p><img src="cid:tkt@booking">',
    });

    const details = mail.html.indexOf("Booking Details");
    const itinerary = mail.html.indexOf("Itinerary");

    expect(details).toBeGreaterThan(-1);
    expect(itinerary).toBeGreaterThan(details);

    // Markup, not escaped text, and the attachment reference is preserved.
    expect(mail.html).toContain("<p>Gate closes 30 min before</p>");
    expect(mail.html).toContain('src="cid:tkt@booking"');

    // The plain-text part carries it too, for a client that reads only that.
    expect(mail.text).toContain("Itinerary:");
    expect(mail.text).toContain("Gate closes 30 min before");
  });

  it("prints no itinerary section when the booking has none", () => {
    const mail = renderBookingConfirmed(BASE);

    expect(mail.html).not.toContain("Itinerary");
    expect(mail.text).not.toContain("Itinerary:");
  });
});

/**
 * The tables the e-ticket shares with the authorization email.
 *
 * The customer keeps the e-ticket, not the message they signed from, so it has
 * to answer the same questions: which cabin, which card, how the total was
 * taken.
 */
describe("the authorization detail on the e-ticket", () => {
  const WITH_DETAIL: BookingEmailData = {
    ...BASE,
    bookedAt: new Date("2026-10-31T12:00:00Z"),
    contactEmail: "gopinder@example.invalid",
    contactPhone: "+1 234 555 0100",
    billingAddress: "12 Example Street, Leeds, LS1 1AA, United Kingdom",
    chargeSplits: [
      { title: "Airline deposit", amountMinor: 100_000 },
      { title: "Balance", amountMinor: 148_000 },
    ],
  };

  it("prints the card and charge tables, split exactly as quoted", () => {
    const html = renderETicket(WITH_DETAIL, CONFIRMED, "x");

    expect(html).toContain("Credit Card Authorization Details");
    expect(html).toContain("12 Example Street");
    expect(html).toContain("Total Charges &amp; Authorization");
    expect(html).toContain("Airline deposit");
    expect(html).toContain("In 2 transactions, as below");
  });

  it("does not ask the customer to acknowledge a document they did not sign", () => {
    const html = renderETicket(WITH_DETAIL, CONFIRMED, "x");

    expect(html).not.toContain("I acknowledge receipt");
  });

  it("states the flight legs once and the total once", () => {
    const html = renderETicket(WITH_DETAIL, CONFIRMED, "x");

    // The legs are the e-ticket's own; nothing else prints them.
    expect(html).toContain("Flight 1");
    // The total belongs to the charges table now, not to both.
    expect(html.match(/\$2,480\.00/g) ?? []).toHaveLength(1);
  });

  it("gives a cruise the full sailing table in place of the summary", () => {
    const html = renderETicket(
      {
        ...WITH_DETAIL,
        product: "CRUISE",
        segments: [],
        cruise: {
          cruiseLine: "Royal Caribbean",
          ship: "Wonder of the Seas",
          departurePort: "Miami, FL",
          sailDate: new Date("2027-02-14T00:00:00Z"),
          returnDate: new Date("2027-02-21T00:00:00Z"),
          nights: 7,
        },
        sailing: {
          cruiseLine: "Royal Caribbean",
          ship: "Wonder of the Seas",
          reservationNumber: "RCL88213",
          sailingName: "7-night Eastern Caribbean",
          specialRequest: null,
          departurePort: "Miami, FL",
          arrivalPort: "Miami, FL",
          sailDate: new Date("2027-02-14T00:00:00Z"),
          returnDate: new Date("2027-02-21T00:00:00Z"),
          nights: 7,
          deckNumber: "10",
          cabinNumber: "10214",
          cabinCategory: "Balcony",
          cabinCount: 2,
          diningPreference: "Late seating",
          gratuitiesIncluded: true,
          insuranceIncluded: false,
        },
      },
      CONFIRMED,
      "x",
    );

    expect(html).toContain("Sailing Details");
    // Detail the one-line cruise summary never carried.
    expect(html).toContain("10214");
    expect(html).toContain("Late seating");
    // And the summary it replaces is gone rather than repeated above it.
    expect(html).not.toContain("Booking Details");
  });

  it("leaves the e-ticket untouched when none of it was loaded", () => {
    const html = renderETicket(BASE, CONFIRMED, "x");

    expect(html).toContain("Booking Details");
    expect(html).not.toContain("Credit Card Authorization Details");
    expect(html).not.toContain("Total Charges");
  });
});
