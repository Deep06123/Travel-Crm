import "server-only";

import type { CardType } from "@/generated/prisma/enums";
import { formatCalendarDate, formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/financial/money";

import type {
  AuthorizationChargeSplit,
  AuthorizationSailing,
} from "./booking-authorization";
import { renderETicket } from "./eticket";
import { htmlToPlainText } from "./html";
import type { PolicyOverrides } from "./policies";

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
   * The card the booking was charged to, as the customer can recognise it.
   *
   * Required rather than optional, on the same reasoning as `policyOverrides`
   * below: a service that builds this object cannot omit it and silently send
   * an e-ticket that does not say what was charged. `null` is the honest value
   * for a booking with no card on it, and the templates render no row for it
   * rather than an empty one.
   *
   * There is no PAN or CVV in the database to expose (`schema.prisma`: the
   * number is discarded in the browser and never submitted), so `cardLast4` is
   * the whole of the number that exists anywhere.
   */
  cardHolderName: string | null;
  cardType: CardType | null;
  cardLast4: string | null;
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
  /**
   * The itinerary composed in the booking's rich-text editor.
   *
   * Already sanitised — it is read back from the column `sanitiseRichText`
   * wrote — and already passed through `prepareItineraryForEmail`, so every
   * image `src` points at an attachment rather than at the administrator-only
   * route it is stored under. Embedded as markup, not escaped; it is the one
   * field in these messages that is markup by design.
   *
   * Null for a booking that has none, which both templates render as no
   * section rather than as an empty one.
   */
  itineraryHtml?: string | null;
  /**
   * The authorization detail, where the builder loaded it.
   *
   * Optional because these fields describe what the cardholder agreed to
   * rather than what was booked, and not every document needs them. The
   * e-ticket prints the same sailing, card and charge tables as the
   * authorization email when they are present — see `authorizationSections` —
   * and leaves each one out when it is not, rather than drawing an empty one.
   *
   * `BookingAuthorizationData` narrows these to required: an email that asks a
   * cardholder to agree to a charge cannot be built without them.
   */
  bookedAt?: Date | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  billingAddress?: string | null;
  chargeSplits?: readonly AuthorizationChargeSplit[];
  sailing?: AuthorizationSailing | null;
  /**
   * The policy wording an operator has rewritten in Settings.
   *
   * Required, not optional, so a service that builds this object cannot omit
   * it and silently send the built-in terms after the business has replaced
   * them. `{}` is the honest value for "nothing overridden".
   */
  policyOverrides: PolicyOverrides;
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

/**
 * The itinerary for the plain-text part: the structured detail, then the
 * composed one.
 *
 * Both, not one or the other. The segments are what the system knows; the
 * composed block is what the agent wrote, and on some bookings it is the only
 * itinerary there is.
 */
function itineraryLines(data: BookingEmailData): string[] {
  return [...structuredItineraryLines(data), ...composedItineraryLines(data)];
}

function composedItineraryLines(data: BookingEmailData): string[] {
  const composed = data.itineraryHtml?.trim();
  if (!composed) return [];

  const lines = htmlToPlainText(composed);
  return lines.length > 0 ? ["", "Itinerary:", ...lines] : [];
}

function structuredItineraryLines(data: BookingEmailData): string[] {
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
  wording: EmailWording = {},
): RenderedEmail {
  // What the operator typed for *this* send beats the booking's standing
  // subject, which is the default for every message rather than a decision
  // about this one.
  const subject = wording.subject?.trim() || data.customEmailSubject?.trim();
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

/**
 * An operator's subject and opening message, in place of the generated ones.
 *
 * Deliberately the same shape, and the same limits, as the authorization
 * email's override: the subject and the block above "Booking Status" are
 * editable, and the document below it is not. It is what the customer is being
 * sent, and hand-typed figures in it would be exactly the discrepancy a
 * dispute turns on.
 */
export interface EmailWording {
  subject?: string | undefined;
  /** Plain text. See `defaultETicketIntro` for what it replaces. */
  body?: string | undefined;
}

/**
 * The opening lines of the plain-text part.
 *
 * The text part is composed separately from the HTML — it is a different
 * document, not a stripped copy — so the override has to be applied to both.
 */
function openingLines(
  data: BookingEmailData,
  lede: string,
  wording: EmailWording,
): string[] {
  const body = wording.body?.trim();
  if (body) return [body];

  return [`Hello ${data.customerName},`, "", lede];
}

export function renderBookingConfirmed(
  data: BookingEmailData,
  wording: EmailWording = {},
): RenderedEmail {
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
    ...openingLines(data, "Your booking is confirmed. The details are below.", wording),
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
      html: renderETicket(data, generatedHeading, "Thank you for booking with us.", {
        ...(wording.body ? { intro: wording.body } : {}),
      }),
    },
    data,
    generatedHeading,
    wording,
  );
}

export function renderBookingTicketed(
  data: BookingEmailData,
  wording: EmailWording = {},
): RenderedEmail {
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
    ...openingLines(
      data,
      data.product === "CRUISE"
        ? "Your cruise documents have been issued."
        : "Your tickets have been issued.",
      wording,
    ),
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
        { ...(wording.body ? { intro: wording.body } : {}) },
      ),
    },
    data,
    generatedHeading,
    wording,
  );
}

