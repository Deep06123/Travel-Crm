import { describe, expect, it } from "vitest";

import {
  renderBookingConfirmed,
  renderBookingTicketed,
  type BookingEmailData,
} from "@/lib/mail/templates";

/**
 * Per-booking subject and heading overrides.
 *
 * The point of storing these is that the customer sees them, so what is
 * asserted here is the rendered output rather than the column round-tripping.
 */

const BASE: BookingEmailData = {
  bookingNumber: "BK-2026-0001",
  customerName: "Priya Nair",
  product: "FLIGHT",
  currency: "USD",
  totalMinor: 248_000,
  travelStartDate: new Date("2027-01-10T00:00:00Z"),
  airlineConfirmation: "6QX4LM",
  segments: [],
  cruise: null,
  passengers: [
    { firstName: "Priya", lastName: "Nair", ticketNumber: "176-2451889301" },
  ],
};

describe("customer email overrides", () => {
  it("uses the generated wording when neither override is set", () => {
    const mail = renderBookingConfirmed(BASE);

    expect(mail.subject).toBe("Booking confirmed — BK-2026-0001");
    expect(mail.html).toContain("YOUR RESERVATION IS CONFIRMED!!");
  });

  it("replaces the subject when one is given", () => {
    const mail = renderBookingConfirmed({
      ...BASE,
      customEmailSubject: "Your Dubai trip is confirmed",
    });

    expect(mail.subject).toBe("Your Dubai trip is confirmed");
  });

  it("replaces the banner heading when one is given", () => {
    const mail = renderBookingConfirmed({
      ...BASE,
      emailTopHeading: "Sunrise Travel",
    });

    expect(mail.html).toContain("Sunrise Travel");
    // The generated heading is gone from the banner, not merely joined by the
    // override — two headings would look like a rendering fault.
    expect(mail.html).not.toContain(">Booking confirmed<");
  });

  it("applies both to the ticketed email too", () => {
    const mail = renderBookingTicketed({
      ...BASE,
      customEmailSubject: "Your tickets are ready",
      emailTopHeading: "Sunrise Travel",
    });

    expect(mail.subject).toBe("Your tickets are ready");
    expect(mail.html).toContain("Sunrise Travel");
  });

  it("ignores blank and whitespace-only overrides", () => {
    // An empty input left in the form means "no override", not "send an
    // empty subject line".
    const mail = renderBookingConfirmed({
      ...BASE,
      customEmailSubject: "   ",
      emailTopHeading: "",
    });

    expect(mail.subject).toBe("Booking confirmed — BK-2026-0001");
    expect(mail.html).toContain("YOUR RESERVATION IS CONFIRMED!!");
  });

  it("escapes an override rather than letting it inject markup", () => {
    const mail = renderBookingConfirmed({
      ...BASE,
      emailTopHeading: '<script>alert("x")</script>',
    });

    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
