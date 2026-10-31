import { formatMoney } from "@/lib/financial/money";

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
}

/** Shared with the authorization email, so both escape identically. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `09-01-2025`, matching the reference ticket rather than the CRM's format. */
export function formatTicketDate(value: Date | null | undefined): string {
  if (!value) return "—";

  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");

  return `${day}-${month}-${value.getUTCFullYear()}`;
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

function sectionHeading(title: string): string {
  return `<tr><td style="background:#0b1f44;padding:12px 20px;color:#ffffff;font-size:17px;font-weight:normal;">${escapeHtml(title)}</td></tr>`;
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

function bookingDetailRows(data: BookingEmailData): string {
  const cell = (label: string, value: string) =>
    `<tr>
  <td style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;font-weight:bold;width:40%;">${escapeHtml(label)}</td>
  <td style="padding:8px 10px;border:1px solid #d9dee5;font-size:13px;">${escapeHtml(value)}</td>
</tr>`;

  if (data.product === "CRUISE") {
    return [
      cell("Cruise line", data.cruise?.cruiseLine ?? "—"),
      cell("Ship", data.cruise?.ship ?? "—"),
      cell("Departure port", data.cruise?.departurePort ?? "—"),
      cell("Sail date", formatTicketDate(data.cruise?.sailDate ?? null)),
      cell("Return date", formatTicketDate(data.cruise?.returnDate ?? null)),
      cell("Booking reference", data.bookingNumber),
      cell("Total", formatMoney(data.totalMinor, data.currency)),
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

  return (
    (legs || cell("Itinerary", "To be confirmed")) +
    cell("Booking reference", data.bookingNumber) +
    cell("Total", formatMoney(data.totalMinor, data.currency))
  );
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

  const greeting = carrier
    ? `You are all set to ${isCruise ? "sail" : "fly"} with ${escapeHtml(carrier.toUpperCase())}.`
    : `Your ${isCruise ? "cruise" : "flight"} booking is below.`;

  // The confirmation the carrier issued. Shown as the large badge in the
  // reference; where there is none, the booking's own reference stands in
  // rather than an empty box implying the carrier confirmed nothing.
  const confirmation = data.airlineConfirmation?.trim() || data.bookingNumber;

  const columns = isCruise ? 4 : 5;

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#333333;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;margin:0 auto;border-collapse:collapse;">

  <tr><td style="background:#0b1f44;padding:14px 20px;text-align:right;color:#ffffff;">
    <div style="font-size:13px;">Call us 24/7</div>
    <div style="font-size:24px;font-weight:bold;letter-spacing:0.5px;">${escapeHtml(options.supportPhone ?? data.supportPhone ?? "")}</div>
  </td></tr>

  <tr><td style="padding:18px 20px;">
    <p style="margin:0 0 8px;font-size:14px;font-weight:bold;color:#333333;">Dear ${escapeHtml(data.customerName)},</p>
    <p style="margin:0 0 6px;font-size:14px;">Greetings for the day!</p>
    <p style="margin:0;font-size:14px;">${greeting}</p>
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

  ${sectionHeading("Booking Details")}

  <tr><td style="padding:16px 20px;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      ${bookingDetailRows(data)}
    </table>
  </td></tr>

  <tr><td style="padding:16px 20px;border-top:1px solid #e5e7eb;">
    <p style="margin:0;font-size:12px;color:#777777;line-height:1.5;">
      Carry photo identification matching the name on this booking, and check
      your carrier's advice on how early to arrive. Reply to this email if any
      detail above needs correcting.
    </p>
  </td></tr>

</table>
</body></html>`;
}
