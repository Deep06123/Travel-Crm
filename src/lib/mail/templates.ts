import "server-only";

import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/financial/money";

/**
 * Customer-facing email bodies.
 *
 * What is deliberately absent matters as much as what is present. These go to
 * an external mailbox over a channel the operator does not control, so they
 * carry no passport number, no date of birth, no supplier cost, no margin and
 * no MCO figure. A customer needs their own itinerary and the amount they are
 * charged; everything else is internal and would be a disclosure, not a
 * courtesy.
 *
 * Ticket numbers are included only in the ticketed email, where they are the
 * point of the message.
 */

export interface SegmentSummary {
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureAt: Date;
  arrivalAt: Date;
}

export interface CruiseSummary {
  cruiseLine: string;
  ship: string | null;
  departurePort: string | null;
  sailDate: Date | null;
  returnDate: Date | null;
  nights: number | null;
}

export interface TicketedPassenger {
  firstName: string;
  lastName: string;
  ticketNumber: string | null;
}

export interface BookingEmailData {
  bookingNumber: string;
  customerName: string;
  product: "FLIGHT" | "CRUISE";
  currency: string;
  totalMinor: number;
  travelStartDate: Date | null;
  airlineConfirmation: string | null;
  segments: readonly SegmentSummary[];
  cruise: CruiseSummary | null;
  passengers: readonly TicketedPassenger[];
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Escapes text interpolated into the HTML part.
 *
 * Every value below originates in an operator-typed form field, so a customer
 * name containing `<` would otherwise break the markup — or inject it.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function itineraryLines(data: BookingEmailData): string[] {
  if (data.product === "CRUISE" && data.cruise) {
    const { cruiseLine, ship, departurePort, sailDate, returnDate, nights } =
      data.cruise;

    const lines = [ship ? `${cruiseLine} — ${ship}` : cruiseLine];
    if (departurePort) lines.push(`Departing from ${departurePort}`);
    if (sailDate) {
      lines.push(
        returnDate
          ? `${formatDate(sailDate)} to ${formatDate(returnDate)}`
          : `Sailing ${formatDate(sailDate)}`,
      );
    }
    if (nights) lines.push(`${nights} ${nights === 1 ? "night" : "nights"}`);
    return lines;
  }

  return data.segments.map(
    (segment) =>
      `${segment.airline} ${segment.flightNumber}  ${segment.origin} → ${segment.destination}  ${formatDate(segment.departureAt)}`,
  );
}

function layout(heading: string, intro: string, rows: string[], footer: string): string {
  // Table-based and inline-styled on purpose: Outlook's rendering engine
  // ignores flexbox, grid and most of a <style> block.
  const body = rows
    .map(
      (row) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">${row}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
    <tr><td style="background:#1e3a8a;padding:16px 24px;color:#ffffff;font-size:18px;font-weight:bold;">${escapeHtml(heading)}</td></tr>
    <tr><td style="padding:24px;">
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.5;">${intro}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${body}</table>
      <p style="margin:16px 0 0;font-size:12px;color:#6b7280;line-height:1.5;">${footer}</p>
    </td></tr>
  </table>
</body></html>`;
}

export function renderBookingConfirmed(data: BookingEmailData): RenderedEmail {
  const total = formatMoney(data.totalMinor, data.currency);
  const itinerary = itineraryLines(data);

  const facts = [
    `Booking reference: ${data.bookingNumber}`,
    ...(data.airlineConfirmation
      ? [`Airline confirmation: ${data.airlineConfirmation}`]
      : []),
    ...itinerary,
    `Total: ${total}`,
  ];

  const text = [
    `Hello ${data.customerName},`,
    "",
    "Your booking is confirmed. The details are below.",
    "",
    ...facts,
    "",
    "Please check the names and dates above and reply to this email if anything",
    "needs correcting.",
    "",
    "Thank you for booking with us.",
  ].join("\n");

  return {
    subject: `Booking confirmed — ${data.bookingNumber}`,
    text,
    html: layout(
      "Booking confirmed",
      `Hello ${escapeHtml(data.customerName)}, your booking is confirmed.`,
      facts.map(escapeHtml),
      "Please check the names and dates above and reply to this email if anything needs correcting.",
    ),
  };
}

export function renderBookingTicketed(data: BookingEmailData): RenderedEmail {
  const issued = data.passengers.filter(
    (passenger) => (passenger.ticketNumber ?? "").trim() !== "",
  );

  const facts = [
    `Booking reference: ${data.bookingNumber}`,
    ...(data.airlineConfirmation
      ? [`Airline confirmation: ${data.airlineConfirmation}`]
      : []),
    ...issued.map(
      (passenger) =>
        `${passenger.firstName} ${passenger.lastName} — ticket ${passenger.ticketNumber}`,
    ),
    ...itineraryLines(data),
  ];

  const text = [
    `Hello ${data.customerName},`,
    "",
    data.product === "CRUISE"
      ? "Your cruise documents have been issued."
      : "Your tickets have been issued.",
    "",
    ...facts,
    "",
    "Carry photo identification matching the name on the ticket, and check your",
    "carrier's advice on how early to arrive.",
    "",
    "Thank you for booking with us.",
  ].join("\n");

  return {
    subject: `Tickets issued — ${data.bookingNumber}`,
    text,
    html: layout(
      data.product === "CRUISE" ? "Documents issued" : "Tickets issued",
      `Hello ${escapeHtml(data.customerName)}, your ${data.product === "CRUISE" ? "cruise documents have" : "tickets have"} been issued.`,
      facts.map(escapeHtml),
      "Carry photo identification matching the name on the ticket, and check your carrier's advice on how early to arrive.",
    ),
  };
}
