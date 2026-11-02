import "server-only";

import type { CardType } from "@/generated/prisma/enums";
import { maskedCard } from "@/lib/financial/card-display";
import { formatMoney } from "@/lib/financial/money";

import {
  escapeHtml,
  formatTicketDate,
  htmlToPlainText,
  itinerarySection,
  sectionHeading,
} from "./html";
import { renderPolicySections } from "./policies";
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

/**
 * The message block at the top of the email, as plain text.
 *
 * Split out so the operator can be shown the generated wording, edit it, and
 * send what they read. Everything below it — the traveller table, the card
 * authorization detail, the charges, the signing button and the policies — is
 * generated from the booking and is deliberately not editable: it is the
 * document the customer is being asked to authorize, and hand-typed figures in
 * it would be exactly the discrepancy a dispute turns on.
 */
export function defaultAuthorizationBody(
  data: BookingAuthorizationData,
): string {
  return [
    `Dear ${data.customerName},`,
    "Greetings for the day!",
    "As per our conversation, we have made the changes to your itinerary. We request you to kindly go through it thoroughly, including the travel details and passenger information, and confirm that all details are correct. If you notice any discrepancies, please inform us right now, as later changes may not be permitted or might be subject to penalties and fees.",
  ].join("\n\n");
}

/**
 * What the operator typed in the editor, where they have edited anything.
 *
 * Both fields are optional and independent at this level; the action that
 * collects them is what insists on having both or neither.
 */
export interface AuthorizationOverride {
  subject?: string | undefined;
  /** Plain text. Blank lines separate paragraphs; the template wraps it. */
  body?: string | undefined;
}

/** The composed itinerary for the plain-text part, or nothing. */
function itineraryText(html: string | null | undefined): string[] {
  const composed = html?.trim();
  if (!composed) return [];

  const lines = htmlToPlainText(composed);
  return lines.length > 0 ? ["", "Itinerary:", ...lines] : [];
}

/** Plain-text paragraphs, blank lines dropped. */
function paragraphs(body: string): string[] {
  return body
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export interface AuthorizationLink {
  /**
   * The one-use link minted by `booking-signature-service`. Interpolated into
   * an `href` rather than escaped as text, so the caller must pass a URL it
   * built itself — never anything a customer supplied.
   *
   * Empty renders the call to action as text rather than a link, for the
   * preview — where no token has been minted and there is nowhere to go. It
   * must not be a placeholder `href`: the preview displays this document in a
   * `srcDoc` iframe, whose base URL is the admin page's own, so even a bare
   * fragment navigates the frame off the email and onto a page it cannot load.
   */
  signUrl: string;
  /** Printed in the email so the customer knows not to sit on it. */
  expiresAt: Date;
}

const CTA_STYLE =
  "display:inline-block;padding:16px 38px;background:#1769e0;color:#ffffff;" +
  "font-size:17px;font-weight:bold;text-decoration:none;border-radius:6px;";

/**
 * The confirm button, as a link or as the shape of one.
 *
 * A `<span>` rather than an anchor with a dead `href` when there is no link to
 * give. The preview renders this document inside a `srcDoc` iframe, which
 * inherits the admin page's base URL, so any `href` at all — including `#` —
 * takes the frame off the email and onto a page the sandbox cannot load. It
 * looks identical either way, which is the point of a preview.
 */
function callToAction(signUrl: string): string {
  return signUrl === ""
    ? `<span style="${CTA_STYLE}opacity:0.75;">CLICK TO CONFIRM</span>`
    : // `target` matters in one place only: in the preview this document sits
      // in a sandboxed iframe, which cannot navigate itself, so the link has
      // to open a tab to go anywhere. Mail clients open links in a browser
      // regardless, so it costs the real email nothing.
      `<a href="${signUrl}" target="_blank" rel="noopener" style="${CTA_STYLE}">CLICK TO CONFIRM</a>`;
}

/**
 * Renders the authorization email.
 *
 * `override` carries an operator's edits from the preview editor. An edited
 * subject and message replace the generated ones; nothing else about the
 * document can be edited, so an email sent from the editor still states the
 * same charges and still carries the signing link.
 */
export function renderBookingAuthorization(
  data: BookingAuthorizationData,
  { signUrl, expiresAt }: AuthorizationLink,
  override: AuthorizationOverride = {},
): RenderedEmail {
  const total = formatMoney(data.totalMinor, data.currency);
  const card = maskedCard(data.cardType, data.cardLast4);
  const confirmation = data.airlineConfirmation?.trim() || data.bookingNumber;
  const charges = chargeLines(data);
  const isCruise = data.product === "CRUISE";

  const message = paragraphs(
    override.body?.trim() || defaultAuthorizationBody(data),
  );

  const text = [
    ...message.flatMap((part) => [part, ""]),
    `Booking ID: ${data.bookingNumber}`,
    `Confirmation: ${confirmation}`,
    `Booked on: ${formatTicketDate(data.bookedAt)}`,
    ...(card ? [`Payment method: ${card}`] : []),
    ...(data.cardHolderName ? [`Card holder: ${data.cardHolderName}`] : []),
    ...(data.billingAddress ? [`Billing address: ${data.billingAddress}`] : []),
    "",
    `Total ${isCruise ? "cruise" : "flight"} booking amount: ${total}`,
    ...charges,
    // Mirrors the HTML part, where the itinerary sits between the charges and
    // the call to action: the cardholder reads what they are agreeing to
    // before they are asked to agree to it, in either part of the message.
    ...itineraryText(data.itineraryHtml),
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
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:720px;margin:0 auto;border-collapse:collapse;">

  <tr><td style="background:#0b1f44;padding:14px 20px;text-align:right;color:#ffffff;">
    <div style="font-size:13px;">Call us 24/7</div>
    <div style="font-size:24px;font-weight:bold;letter-spacing:0.5px;">${escapeHtml(data.supportPhone ?? "")}</div>
  </td></tr>

  <tr><td style="padding:18px 20px;">
    ${message
      .map((part, index) => {
        const last = index === message.length - 1;
        // The opening line is the salutation in the generated wording and
        // reads as one in an edited message too, so it keeps its weight.
        const weight = index === 0 ? "font-weight:bold;" : "";
        return `<p style="margin:0 0 ${last ? "0" : "8px"};font-size:14px;line-height:1.6;${weight}">${escapeHtml(part).replace(/\r?\n/g, "<br />")}</p>`;
      })
      .join("")}
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

  <!-- Above the call to action deliberately: the itinerary is what the
       cardholder is being asked to agree to, so it has to be readable before
       the button, not after it. -->
  ${itinerarySection(data.itineraryHtml)}

  <tr><td style="padding:10px 20px 28px;text-align:center;">
    ${callToAction(signUrl)}
    <p style="margin:12px 0 0;font-size:12px;color:#777777;">This link is for you alone and stops working after ${escapeHtml(formatTicketDate(expiresAt))}.</p>
  </td></tr>

  ${renderPolicySections({
    document: "authorization",
    isCruise,
    supportPhone: data.supportPhone,
    overrides: data.policyOverrides,
  })}

</table>
</body></html>`;

  return {
    subject:
      override.subject?.trim() ||
      data.customEmailSubject?.trim() ||
      `Please confirm your booking — ${data.bookingNumber}`,
    text,
    html,
  };
}
