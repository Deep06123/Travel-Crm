import "server-only";

import { formatCalendarDate, formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/financial/money";

import { renderETicket } from "./eticket";

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
  /** Shown on the e-ticket's traveller table. */
  gender?: string | null;
  dateOfBirth?: Date | null;
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
  /**
   * Per-booking overrides, both optional.
   *
   * Applied at the end of rendering rather than threaded through each
   * template, so a template cannot forget to honour one and the generated
   * wording stays the fallback rather than being replaced wholesale.
   */
  customEmailSubject?: string | null;
  emailTopHeading?: string | null;
  /** Support number for the e-ticket header, from the booking's TFN. */
  supportPhone?: string | null;
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
          ? `${formatCalendarDate(sailDate)} to ${formatCalendarDate(returnDate)}`
          : `Sailing ${formatCalendarDate(sailDate)}`,
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

/**
 * Applies the booking's subject and heading overrides, if it has any.
 *
 * The heading is substituted inside the rendered HTML rather than passed into
 * `layout`, because `layout` is also used by paths that have no booking to
 * take an override from. Blank or whitespace-only values are ignored: an empty
 * input left in the form means "no override", not "send an empty subject".
 */
function withOverrides(
  rendered: RenderedEmail,
  data: BookingEmailData,
  generatedHeading: string,
): RenderedEmail {
  const subject = data.customEmailSubject?.trim();
  const heading = data.emailTopHeading?.trim();

  return {
    ...rendered,
    ...(subject ? { subject } : {}),
    ...(heading
      ? {
          html: rendered.html.replace(
            escapeHtml(generatedHeading),
            escapeHtml(heading),
          ),
        }
      : {}),
  };
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

  // The status line doubles as the document's heading, so `emailTopHeading`
  // has something to replace. Passing a different string to `withOverrides`
  // than the one rendered would make the override silently do nothing.
  const generatedHeading = "YOUR RESERVATION IS CONFIRMED!!";

  return withOverrides(
    {
      subject: `Booking confirmed — ${data.bookingNumber}`,
      text,
      html: renderETicket(data, generatedHeading, "Thank you for booking with us."),
    },
    data,
    generatedHeading,
  );
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

  // A cruise is confirmed by the cruise line rather than ticketed by an
  // airline, so the generated heading differs by product — and the override
  // has to be told which one it is replacing.
  const generatedHeading =
    data.product === "CRUISE"
      ? "YOUR CRUISE DOCUMENTS ARE ISSUED!!"
      : "YOUR E-TICKET IS ISSUED!!";

  return withOverrides(
    {
      subject: `Tickets issued — ${data.bookingNumber}`,
      text,
      html: renderETicket(
        data,
        generatedHeading,
        "Carry photo identification matching the name on the ticket.",
      ),
    },
    data,
    generatedHeading,
  );
}

/**
 * Wraps an operator-edited message in the standard email shell.
 *
 * The operator edits plain text, never HTML, and this is what turns it back
 * into a styled email. That is a deliberate limitation rather than a missing
 * feature: anything typed into a textarea and sent verbatim as HTML is an
 * injection path into a customer's inbox, and a half-closed tag pasted from a
 * word processor would wreck the layout for everyone who received it. Escaping
 * the text and supplying the markup ourselves means an edited email cannot be
 * malformed and cannot carry anything the operator did not intend.
 *
 * Blank lines separate paragraphs; single newlines are kept as line breaks, so
 * what the operator sees in the textarea is what the customer receives.
 */
export function renderEditedEmail(
  subject: string,
  body: string,
): RenderedEmail {
  const text = body.trim();

  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.5;">${escapeHtml(
          paragraph,
        ).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  return {
    subject: subject.trim(),
    text,
    // Same shell as the generated templates, so an edited email still looks
    // like it came from the same agency.
    html: `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
    <tr><td style="background:#1e3a8a;padding:16px 24px;color:#ffffff;font-size:18px;font-weight:bold;">${escapeHtml(subject.trim())}</td></tr>
    <tr><td style="padding:24px;">${paragraphs}</td></tr>
  </table>
</body></html>`,
  };
}
