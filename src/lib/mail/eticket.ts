import { maskedCard } from "@/lib/financial/card-display";
import { formatMoney } from "@/lib/financial/money";

import {
  authorizationSectionHtml,
  authorizationSections,
  type AuthorizationPairsSection,
} from "./booking-authorization";
import {
  escapeHtml,
  formatTicketDate,
  itinerarySection,
  sectionHeading,
} from "./html";
import { renderPolicySections } from "./policies";
import type { BookingEmailData } from "./templates";

/**
 * The e-ticket, rendered once and used in two places.
 *
 * The same function produces the customer's email body and the page staff open
 * to check it. That is the point: a preview rendered by different code than the
 * message it previews will eventually disagree with it, and the disagreement
 * surfaces after the email has gone out rather than before.
 *
 * Written as tables with inline styles because it has to survive Outlook,
 * which ignores flexbox, grid and most of a `<style>` block. The page shows
 * the same markup, so what staff check is the thing that is sent — including
 * its quirks.
 */

export interface ETicketOptions {
  /**
   * Masks each date of birth.
   *
   * True when staff without `passenger.viewSensitive` are viewing the page.
   * Never true for the customer's own copy: it is their date of birth, and the
   * ticket is addressed to them.
   */
  redactDateOfBirth?: boolean;
  /** Support number shown in the header, from the booking's TFN. */
  supportPhone?: string | null;
  /**
   * The operator's opening message, in place of the generated one.
   *
   * Only the block above "Booking Status" — the document itself is what the
   * customer is being sent and is not editable, exactly as on the
   * authorization email. An edited send used to replace the whole document
   * with a plain shell, which deleted the ticket from the customer's email.
   *
   * Plain text. Blank lines separate paragraphs; the markup is supplied here
   * so an edited message cannot arrive malformed.
   */
  intro?: string | null;
}

/**
 * The carrier the traveller is actually flying or sailing with.
 *
 * Taken from the first segment rather than stored on the booking, because that
 * is where the airline is recorded. Falls back to wording that names no
 * carrier at all rather than inventing one.
 */
function carrierName(data: BookingEmailData): string | null {
  if (data.product === "CRUISE") return data.cruise?.cruiseLine ?? null;
  return data.segments[0]?.airline ?? null;
}

function travellerRows(
  data: BookingEmailData,
  options: ETicketOptions,
): string {
  const isCruise = data.product === "CRUISE";

  return data.passengers
    .map((passenger, index) => {
      const name = `${passenger.firstName} ${passenger.lastName}`.trim();
      const dob = options.redactDateOfBirth
        ? "••••••••••"
        : formatTicketDate(passenger.dateOfBirth ?? null);

      return `<tr>
  <td style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;">${index + 1}</td>
  <td style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;">${escapeHtml(name)}</td>
  <td style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;">${escapeHtml(passenger.gender ?? "—")}</td>
  <td style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;">${dob}</td>
  ${isCruise ? "" : `<td style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;">${escapeHtml(passenger.ticketNumber ?? "—")}</td>`}
</tr>`;
    })
    .join("");
}

/**
 * The sailing, card and charge tables, exactly as the authorization email
 * states them.
 *
 * A customer who comes back months later has the e-ticket in their inbox, not
 * the authorization email, so the document they keep has to answer the same
 * questions: which cabin, which card, and how the total was taken. The same
 * builder renders all three, which is what stops this drifting from the
 * message they agreed to.
 *
 * The traveller table is left behind deliberately — `Traveler Details` above
 * is the e-ticket's own, and it redacts dates of birth for staff who may not
 * see them. So is the acknowledgement: it is the wording of a signature, and
 * nobody signs an e-ticket.
 *
 * Empty when the builder loaded none of this, which keeps an older caller's
 * e-ticket exactly as it was rather than drawing blank tables.
 */
function authorizationDetail(data: BookingEmailData): AuthorizationPairsSection[] {
  const present =
    data.bookedAt != null ||
    data.billingAddress != null ||
    data.sailing != null ||
    (data.chargeSplits?.length ?? 0) > 0;

  if (!present) return [];

  return authorizationSections(data)
    .filter(
      (section): section is AuthorizationPairsSection => section.kind === "pairs",
    )
    // Rebuilt without `statement` rather than spread-and-deleted, so the
    // acknowledgement cannot creep back in behind a rename.
    .map(({ title, rows, note }) => ({
      kind: "pairs" as const,
      title,
      rows,
      ...(note ? { note } : {}),
    }));
}

/**
 * The booking's own summary table.
 *
 * `withDetail` says the authorization tables below will state the reference,
 * the card and the total in full. The cruise summary is then entirely
 * contained in `Sailing Details` and drops out; a flight keeps its legs, which
 * nothing else prints, and sheds only the rows that would be said twice.
 */
function bookingDetailRows(
  data: BookingEmailData,
  withDetail: boolean,
): string {
  const cell = (label: string, value: string) =>
    `<tr>
  <td style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;font-weight:bold;width:40%;">${escapeHtml(label)}</td>
  <td style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;">${escapeHtml(value)}</td>
</tr>`;

  // The card follows the total everywhere it appears: the customer reads what
  // was charged, then what it was charged to. Each row is omitted rather than
  // emptied when the booking has no card — "Payment method —" on a receipt
  // reads as a fault, where no row reads as nothing to say.
  const card = maskedCard(data.cardType, data.cardLast4);
  const paymentRows =
    (data.cardHolderName ? cell("Card holder", data.cardHolderName) : "") +
    (card ? cell("Payment method", card) : "");

  if (data.product === "CRUISE") {
    if (withDetail) return "";

    return [
      cell("Cruise line", data.cruise?.cruiseLine ?? "—"),
      cell("Ship", data.cruise?.ship ?? "—"),
      cell("Departure port", data.cruise?.departurePort ?? "—"),
      cell("Sail date", formatTicketDate(data.cruise?.sailDate ?? null)),
      cell("Return date", formatTicketDate(data.cruise?.returnDate ?? null)),
      cell("Booking reference", data.bookingNumber),
      cell("Total", formatMoney(data.totalMinor, data.currency)),
      paymentRows,
    ].join("");
  }

  // One block per leg. A return trip is two legs, and collapsing them into a
  // single "outbound/return" pair would misrepresent a multi-city itinerary.
  const legs = data.segments
    .map((segment, index) =>
      [
        cell(
          `Flight ${index + 1}`,
          `${segment.airline} ${segment.flightNumber}`.trim(),
        ),
        cell("From", segment.origin),
        cell("To", segment.destination),
        cell("Departs", formatTicketDate(segment.departureAt)),
      ].join(""),
    )
    .join("");

  const flights = legs || cell("Itinerary", "To be confirmed");

  return withDetail
    ? flights
    : flights +
        cell("Booking reference", data.bookingNumber) +
        cell("Total", formatMoney(data.totalMinor, data.currency)) +
        paymentRows;
}

/**
 * The opening message above "Booking Status", as plain text.
 *
 * Split out so an operator can be shown the generated wording, edit it, and
 * send what they read — the counterpart of `defaultAuthorizationBody`. The
 * document below it is generated from the booking and stays generated.
 */
export function defaultETicketIntro(data: BookingEmailData): string {
  const carrier = carrierName(data);
  const isCruise = data.product === "CRUISE";

  return [
    `Dear ${data.customerName},`,
    "Greetings for the day!",
    carrier
      ? `You are all set to ${isCruise ? "sail" : "fly"} with ${carrier.toUpperCase()}.`
      : `Your ${isCruise ? "cruise" : "flight"} booking is below.`,
  ].join("\n\n");
}

/** Plain-text paragraphs, blank lines dropped. */
function introParagraphs(intro: string): string[] {
  return intro
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The opening block, as the markup the generated wording has always produced.
 *
 * The first paragraph carries the salutation's weight — it reads as one in an
 * edited message too — and the last loses its bottom margin. With the
 * generated intro this renders exactly the markup it replaced, so a booking
 * nobody has edited sends a byte-identical document.
 */
function introHtml(intro: string): string {
  const parts = introParagraphs(intro);

  return parts
    .map((part, index) => {
      const body = escapeHtml(part).replace(/\r?\n/g, "<br />");
      const last = index === parts.length - 1;

      // `margin:0` on the last one, written exactly as the generated block
      // always wrote it: the shorthand is equivalent to `0 0 0`, but this
      // document is diffed against mailbox screenshots and a booking nobody
      // has edited should render byte-for-byte what it rendered before.
      const margin = last ? "0" : index === 0 ? "0 0 8px" : "0 0 6px";

      if (index === 0) {
        return `<p style="margin:${margin};font-size:14px;font-weight:bold;color:#333333;">${body}</p>`;
      }

      return `<p style="margin:${margin};font-size:14px;">${body}</p>`;
    })
    .join("\n    ");
}

/**
 * Renders the complete e-ticket document.
 *
 * `statusLine` and `statusNote` are passed in rather than derived here, so the
 * confirmation and ticketed messages can differ without this function needing
 * to know which event it is rendering.
 */
export function renderETicket(
  data: BookingEmailData,
  statusLine: string,
  statusNote: string,
  options: ETicketOptions = {},
): string {
  const carrier = carrierName(data);
  const isCruise = data.product === "CRUISE";

  // The confirmation the carrier issued. Shown as the large badge in the
  // reference; where there is none, the booking's own reference stands in
  // rather than an empty box implying the carrier confirmed nothing.
  const confirmation = data.airlineConfirmation?.trim() || data.bookingNumber;

  const columns = isCruise ? 4 : 5;

  const detail = authorizationDetail(data);
  const detailRows = bookingDetailRows(data, detail.length > 0);

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#333333;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:720px;margin:0 auto;border-collapse:collapse;">

  <tr><td style="background:#0b1f44;padding:14px 20px;text-align:right;color:#ffffff;">
    <div style="font-size:13px;">Call us 24/7</div>
    <div style="font-size:24px;font-weight:bold;letter-spacing:0.5px;">${escapeHtml(options.supportPhone ?? data.supportPhone ?? "")}</div>
  </td></tr>

  <tr><td style="padding:18px 20px;">
    ${introHtml(options.intro?.trim() || defaultETicketIntro(data))}
  </td></tr>

  ${sectionHeading("Booking Status")}

  <tr><td style="padding:20px;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td style="padding-right:14px;vertical-align:middle;">
          <div style="width:44px;height:44px;border-radius:22px;background:#6cbe11;color:#ffffff;font-size:26px;line-height:44px;text-align:center;font-weight:bold;">&#10003;</div>
        </td>
        <td style="vertical-align:middle;">
          <div style="font-size:16px;font-weight:bold;color:#0000cc;">${escapeHtml(statusLine)}</div>
          <div style="font-size:13px;color:#555555;">${escapeHtml(statusNote)}</div>
        </td>
      </tr>
    </table>

    <div style="border-top:1px solid #e5e7eb;margin:18px 0;"></div>

    <div style="text-align:center;">
      <div style="font-size:14px;font-weight:bold;color:#555555;">Your ${escapeHtml((carrier ?? "booking").toUpperCase())} Confirmation No.</div>
      <div style="display:inline-block;margin-top:10px;padding:6px 18px;background:#f3f4f8;font-size:28px;font-weight:bold;color:#0000cc;">${escapeHtml(confirmation)}</div>
    </div>
  </td></tr>

  ${sectionHeading("Traveler Details")}

  <tr><td style="padding:16px 20px;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      <tr style="background:#f7f8fa;">
        <th align="left" style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;">S.N.</th>
        <th align="left" style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;">Passenger Name</th>
        <th align="left" style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;">Gender</th>
        <th align="left" style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;">DOB</th>
        ${isCruise ? "" : '<th align="left" style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;">E-Ticket No.</th>'}
      </tr>
      ${
        travellerRows(data, options) ||
        `<tr><td colspan="${columns}" style="padding:10px;border:1px solid #d9dee5;font-size:13px;color:#777777;">No travellers recorded.</td></tr>`
      }
    </table>
  </td></tr>

  ${
    detailRows
      ? `${sectionHeading("Booking Details")}

  <tr><td style="padding:16px 20px;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      ${detailRows}
    </table>
  </td></tr>`
      : ""
  }

  ${detail.map(authorizationSectionHtml).join("\n\n  ")}

  <!-- The itinerary as the agent composed it, below the structured detail it
       elaborates on. Sometimes it is the carrier's own ticket as an image, in
       which case this is the part of the email the customer actually travels
       on. -->
  ${itinerarySection(data.itineraryHtml)}

  <tr><td style="padding:16px 20px;border-top:1px solid #e5e7eb;">
    <p style="margin:0;font-size:12px;color:#777777;line-height:1.5;">
      Carry photo identification matching the name on this booking, and check
      your carrier's advice on how early to arrive. Reply to this email if any
      detail above needs correcting.
    </p>
  </td></tr>

  <!-- The same terms the customer authorized, repeated at the foot of the
       document they will actually keep. A customer who comes back months later
       over a change fee has the e-ticket in their inbox, not the authorization
       email, so the rules have to be on this one too. -->
  ${renderPolicySections({
    document: "eticket",
    isCruise,
    supportPhone: options.supportPhone ?? data.supportPhone ?? null,
    overrides: data.policyOverrides,
  })}

</table>
</body></html>`;
}
