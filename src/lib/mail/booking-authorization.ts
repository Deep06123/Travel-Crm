import "server-only";

import type { CardType } from "@/generated/prisma/enums";
import { CARD_BRAND_RULES } from "@/features/bookings/card-validation";
import { formatMoney } from "@/lib/financial/money";

import { escapeHtml, formatTicketDate } from "./eticket";
import type { BookingEmailData, RenderedEmail } from "./templates";

/**
 * The card authorization email, and the link the customer signs from it.
 *
 * Distinct from the e-ticket in `eticket.ts` because it does a different job:
 * the e-ticket reports what was booked, this one asks the cardholder to agree
 * to being charged for it. It therefore carries the card and billing detail
 * the e-ticket deliberately omits, and ends in a single call to action.
 *
 * Only the brand and last four digits of the card appear — those are all the
 * database holds. A PAN is never submitted by the booking form and so cannot
 * reach this template, which is the point: an email is not a channel anyone
 * should be able to put a card number down.
 *
 * Tables with inline styles throughout, matching `eticket.ts`, because Outlook
 * ignores flexbox, grid and most of a `<style>` block.
 */

export interface AuthorizationChargeSplit {
  title: string;
  amountMinor: number;
}

export interface BookingAuthorizationData extends BookingEmailData {
  /** When the booking was taken, shown in the authorization block. */
  bookedAt: Date;
  contactEmail: string | null;
  contactPhone: string | null;
  cardHolderName: string | null;
  cardType: CardType | null;
  cardLast4: string | null;
  billingAddress: string | null;
  /** Empty when the total is taken as a single charge. */
  chargeSplits: readonly AuthorizationChargeSplit[];
}

function cardBrandLabel(type: CardType | null): string | null {
  if (!type) return null;
  return CARD_BRAND_RULES.find((rule) => rule.type === type)?.label ?? "Card";
}

/**
 * `Visa (****1111)`, or as much of it as the booking knows.
 *
 * Returns `null` rather than a placeholder when there is no card on the
 * booking at all: an authorization block naming no card is misleading, so the
 * section is omitted instead.
 */
function maskedCard(data: BookingAuthorizationData): string | null {
  const brand = cardBrandLabel(data.cardType);
  const last4 = data.cardLast4?.trim();

  if (!brand && !last4) return null;
  if (!last4) return brand;

  return brand ? `${brand} (****${last4})` : `****${last4}`;
}

function sectionHeading(title: string): string {
  return `<tr><td style="background:#0b1f44;padding:12px 20px;color:#ffffff;font-size:17px;font-weight:normal;">${escapeHtml(title)}</td></tr>`;
}

const CELL = "padding:8px 10px;border:1px solid #d9dee5;font-size:13px;";

function labelledRow(label: string, value: string): string {
  return `<tr>
  <td style="${CELL}font-weight:bold;width:40%;">${escapeHtml(label)}</td>
  <td style="${CELL}">${escapeHtml(value)}</td>
</tr>`;
}

function travellerRows(data: BookingAuthorizationData): string {
  const isCruise = data.product === "CRUISE";

  const rows = data.passengers
    .map((passenger, index) => {
      const name = `${passenger.firstName} ${passenger.lastName}`.trim();

      return `<tr>
  <td style="${CELL}">${index + 1}</td>
  <td style="${CELL}">${escapeHtml(name)}</td>
  <td style="${CELL}">${escapeHtml(passenger.gender ?? "—")}</td>
  <td style="${CELL}">${formatTicketDate(passenger.dateOfBirth ?? null)}</td>
  ${isCruise ? "" : `<td style="${CELL}">${escapeHtml(passenger.ticketNumber ?? "—")}</td>`}
</tr>`;
    })
    .join("");

  return (
    rows ||
    `<tr><td colspan="${isCruise ? 4 : 5}" style="${CELL}color:#777777;">No travellers recorded.</td></tr>`
  );
}

/**
 * How the total will be taken.
 *
 * The reference email spells this out because a customer who agreed to one
 * figure and then sees two charges on their statement raises a dispute. Where
 * there are no splits the single charge is stated just as plainly.
 */
function chargeLines(data: BookingAuthorizationData): string[] {
  const total = formatMoney(data.totalMinor, data.currency);

  if (data.chargeSplits.length === 0) {
    return [`The total of ${total} will be charged as a single transaction.`];
  }

  return [
    `The total of ${total} may be charged in more than one transaction, as:`,
    ...data.chargeSplits.map(
      (split) =>
        `${split.title}: ${formatMoney(split.amountMinor, data.currency)}`,
    ),
    "The sum charged will be the same as the total quoted above.",
  ];
}

const ACKNOWLEDGEMENT =
  "I acknowledge receipt of this email for the charges described herein, and " +
  "fully understand and agree to the itinerary and ticket restrictions. I have " +
  "checked and verified all details, including passenger names, dates and timings.";

const BOOKING_POLICY = [
  "Cards will be charged only after we receive your authorization from the cardholder.",
  "You will receive your e-tickets and carrier confirmation in a separate email.",
  "Tickets are issued once the payment has been successfully processed.",
  "If you do not receive an email or call within 24 hours of making this reservation, please contact us.",
  "We strongly recommend all travellers confirm the status of their flight at least 24–48 hours before departure.",
];

const CHANGE_RULES = [
  "Travel itinerary changes, if permitted by the airline fare rules, may incur a change fee imposed by the airline, which can vary by market, carrier and fare conditions. An administrative fee may also apply.",
  "Name changes are not permitted under any circumstances.",
  "Tickets are generally non-refundable unless the airline's fare rules say otherwise. On a refundable ticket the airline may apply a cancellation penalty as per its fare rules.",
  "Refunds, where applicable, are processed from the date the cancellation request is created and are issued in the same form of payment used at the time of booking.",
  "No refunds are provided in the case of a no-show.",
];

const TRAVEL_RULES = [
  "All passengers must hold the valid travel documents, including a valid passport and any necessary visas, at the time of travel.",
  "Please review your tickets and itinerary carefully on receipt. All times shown are local time.",
  "Arrive at the airport at least 3 hours before an international departure and 2 hours before a domestic one.",
  "All international flights should be reconfirmed at least 72 hours prior to departure.",
  "Tickets submitted for refund or reissue are subject to the applicable airline charges, if any.",
  "We do not assume responsibility for, and will not compensate passengers for, travel interruptions caused by circumstances beyond our control, including acts of God or changes made by airlines, hotels, cruise companies or tour operators.",
  "We strongly advise all customers to purchase travel insurance and to review the terms and conditions applicable to their tickets.",
  "Please keep a copy of this email for your records. It serves as confirmation of your booking request; the e-ticket receipt will be sent shortly.",
];

function bulletList(items: readonly string[]): string {
  return `<ul style="margin:0;padding-left:20px;font-size:13px;color:#444444;line-height:1.6;">${items
    .map((item) => `<li style="margin-bottom:6px;">${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
}

export interface AuthorizationLink {
  /**
   * The one-use link minted by `booking-signature-service`. Interpolated into
   * an `href` rather than escaped as text, so the caller must pass a URL it
   * built itself — never anything a customer supplied.
   */
  signUrl: string;
  /** Printed in the email so the customer knows not to sit on it. */
  expiresAt: Date;
}

/** Renders the authorization email. */
export function renderBookingAuthorization(
  data: BookingAuthorizationData,
  { signUrl, expiresAt }: AuthorizationLink,
): RenderedEmail {
  const total = formatMoney(data.totalMinor, data.currency);
  const card = maskedCard(data);
  const confirmation = data.airlineConfirmation?.trim() || data.bookingNumber;
  const charges = chargeLines(data);
  const isCruise = data.product === "CRUISE";

  const text = [
    `Dear ${data.customerName},`,
    "",
    "Greetings for the day!",
    "",
    "As per our conversation, we have made the changes to your itinerary. Please",
    "go through it thoroughly, including the travel details and passenger",
    "information, and confirm that all details are correct.",
    "",
    `Booking ID: ${data.bookingNumber}`,
    `Confirmation: ${confirmation}`,
    `Booked on: ${formatTicketDate(data.bookedAt)}`,
    ...(card ? [`Payment method: ${card}`] : []),
    ...(data.cardHolderName ? [`Card holder: ${data.cardHolderName}`] : []),
    ...(data.billingAddress ? [`Billing address: ${data.billingAddress}`] : []),
    "",
    `Total ${isCruise ? "cruise" : "flight"} booking amount: ${total}`,
    ...charges,
    "",
    ACKNOWLEDGEMENT,
    "",
    "Confirm and sign your booking here:",
    signUrl,
    `This link is for you alone and stops working after ${formatTicketDate(expiresAt)}.`,
    "",
    "If you notice any discrepancies, please tell us now: later changes may not",
    "be permitted, or may be subject to penalties and fees.",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#333333;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;margin:0 auto;border-collapse:collapse;">

  <tr><td style="background:#0b1f44;padding:14px 20px;text-align:right;color:#ffffff;">
    <div style="font-size:13px;">Call us 24/7</div>
    <div style="font-size:24px;font-weight:bold;letter-spacing:0.5px;">${escapeHtml(data.supportPhone ?? "")}</div>
  </td></tr>

  <tr><td style="padding:18px 20px;">
    <p style="margin:0 0 8px;font-size:14px;font-weight:bold;">Dear ${escapeHtml(data.customerName)},</p>
    <p style="margin:0 0 6px;font-size:14px;">Greetings for the day!</p>
    <p style="margin:0;font-size:14px;line-height:1.6;">As per our conversation, we have made the changes to your itinerary. We request you to kindly go through it thoroughly, including the travel details and passenger information, and confirm that all details are correct. If you notice any discrepancies, please inform us right now, as later changes may not be permitted or might be subject to penalties and fees.</p>
  </td></tr>

  <tr><td style="padding:0 20px 18px;">
    <div style="font-size:14px;"><strong>Booking Id:</strong> <span style="color:#0000cc;font-weight:bold;">${escapeHtml(data.bookingNumber)}</span></div>
  </td></tr>

  <tr><td style="padding:0 20px 20px;text-align:center;">
    <div style="font-size:14px;font-weight:bold;color:#555555;">Your Confirmation No.</div>
    <div style="display:inline-block;margin-top:10px;padding:6px 18px;background:#f3f4f8;font-size:28px;font-weight:bold;color:#0000cc;">${escapeHtml(confirmation)}</div>
  </td></tr>

  ${sectionHeading("Traveller's Detail")}

  <tr><td style="padding:16px 20px;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      <tr style="background:#f7f8fa;">
        <th align="left" style="${CELL}">SL No.</th>
        <th align="left" style="${CELL}">Passenger's Name</th>
        <th align="left" style="${CELL}">Gender</th>
        <th align="left" style="${CELL}">Date of Birth</th>
        ${isCruise ? "" : `<th align="left" style="${CELL}">E-Ticket No.</th>`}
      </tr>
      ${travellerRows(data)}
    </table>
  </td></tr>

  ${sectionHeading("Credit Card Authorization Details")}

  <tr><td style="padding:16px 20px;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      ${labelledRow("Booking ID", data.bookingNumber)}
      ${labelledRow("Booked on", formatTicketDate(data.bookedAt))}
      ${data.contactPhone ? labelledRow("Phone", data.contactPhone) : ""}
      ${data.contactEmail ? labelledRow("Email", data.contactEmail) : ""}
      ${card ? labelledRow("Payment method", card) : ""}
      ${data.cardHolderName ? labelledRow("Card holder name", data.cardHolderName) : ""}
      ${data.billingAddress ? labelledRow("Billing address", data.billingAddress) : ""}
    </table>
    <p style="margin:12px 0 0;font-size:13px;color:#555555;">Please review the above details carefully and confirm that all information is accurate. If any corrections are required, kindly inform us at the earliest.</p>
  </td></tr>

  ${sectionHeading("Total Charges & Authorization")}

  <tr><td style="padding:16px 20px;">
    <p style="margin:0 0 10px;font-size:14px;"><strong>Total ${isCruise ? "cruise" : "flight"} booking amount:</strong> <span style="color:#0000cc;font-weight:bold;">${escapeHtml(total)}</span></p>
    ${charges
      .map(
        (line) =>
          `<p style="margin:0 0 6px;font-size:13px;color:#444444;">${escapeHtml(line)}</p>`,
      )
      .join("")}
    <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#333333;">${escapeHtml(ACKNOWLEDGEMENT)}</p>
  </td></tr>

  <tr><td style="padding:10px 20px 28px;text-align:center;">
    <a href="${signUrl}" style="display:inline-block;padding:16px 38px;background:#1769e0;color:#ffffff;font-size:17px;font-weight:bold;text-decoration:none;border-radius:6px;">CLICK TO CONFIRM</a>
    <p style="margin:12px 0 0;font-size:12px;color:#777777;">This link is for you alone and stops working after ${escapeHtml(formatTicketDate(expiresAt))}.</p>
  </td></tr>

  ${sectionHeading("Booking Policy")}
  <tr><td style="padding:16px 20px;">${bulletList(BOOKING_POLICY)}</td></tr>

  ${sectionHeading("Change Rules")}
  <tr><td style="padding:16px 20px;">${bulletList(CHANGE_RULES)}</td></tr>

  ${sectionHeading(isCruise ? "Cruise Rules and Restrictions" : "Flight Rules and Restrictions")}
  <tr><td style="padding:16px 20px;">${bulletList(TRAVEL_RULES)}</td></tr>

  <tr><td style="padding:16px 20px;border-top:1px solid #e5e7eb;text-align:center;">
    <div style="font-size:15px;font-weight:bold;color:#333333;">We are open 24x7 — Call us @ <span style="color:#0000cc;">${escapeHtml(data.supportPhone ?? "")}</span></div>
  </td></tr>

</table>
</body></html>`;

  return {
    subject:
      data.customEmailSubject?.trim() ||
      `Please confirm your booking — ${data.bookingNumber}`,
    text,
    html,
  };
}
