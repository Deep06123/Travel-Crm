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
});
