import {
  authorizationDocumentHtml,
  authorizationDocumentText,
  type BookingAuthorizationData,
} from "./booking-authorization";
import { escapeHtml } from "./html";

import {
  bookingRows,
  securityRows,
  type EvidenceRow,
  type SignatureEvidence,
} from "@/lib/signature/evidence";

/**
 * The confirmation that goes back to the mailbox the invitation came from.
 *
 * Addressed to the business, not the customer, so it is written like the
 * internal notices in `admin-notice.ts` — skimmable, no branding, no policy
 * blocks. It is not built from `renderAdminNotice` all the same: that renders
 * a short notice that something happened, and this is the covering note for a
 * legal document, with the consent wording reproduced in full and a security
 * section whose nine fields are always all present.
 *
 * The PDF is the record. This message exists so the record arrives in the
 * right inbox with enough context to be filed without opening it.
 */

export interface RenderedSignatureConfirmation {
  subject: string;
  text: string;
  html: string;
}

function textSection(title: string, rows: readonly EvidenceRow[]): string[] {
  return [
    "",
    title.toUpperCase(),
    ...rows.map((row) => `  ${row.label}: ${row.value}`),
  ];
}

function htmlSection(title: string, rows: readonly EvidenceRow[]): string {
  const cells = rows
    .map(
      (row) => `
        <tr>
          <td style="padding:6px 20px;color:#5b6472;font-size:13px;width:42%;vertical-align:top;">${escapeHtml(row.label)}</td>
          <td style="padding:6px 20px;color:#0b1f44;font-size:13px;font-weight:bold;vertical-align:top;">${escapeHtml(row.value)}</td>
        </tr>`,
    )
    .join("");

  return `
      <tr>
        <td colspan="2" style="padding:18px 20px 4px;color:#5b6472;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid #eceef1;">${escapeHtml(title)}</td>
      </tr>
      ${cells}`;
}

/**
 * The booking as the authorization email stated it, where it could be loaded.
 *
 * Optional because the covering note must still go out if the booking has since
 * been deleted or the load fails — a confirmation that arrives without the
 * tables is worth more than one that never arrives. `itineraryHtml` must be the
 * prepared form (`prepareItineraryForEmail`), and its attachments carried on
 * the same message, or the images in it resolve to nothing.
 */
/**
 * The signed document, below the evidence, as its own table.
 *
 * A separate table rather than more rows in the one above it: those rows are a
 * two-column label/value grid, and the authorization sections are full-width
 * single-cell rows. Nesting one inside the other leaves Outlook to guess at the
 * column widths, and it guesses badly.
 */
function documentTable(booking: BookingAuthorizationData | null | undefined): string {
  if (!booking) return "";

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:620px;margin:16px auto 0;background:#ffffff;border:1px solid #dfe3e8;border-collapse:collapse;">
      <tr><td style="background:#0b1f44;padding:12px 20px;color:#ffffff;font-size:17px;">What the customer signed</td></tr>
      <tr><td style="padding:12px 20px 0;color:#5b6472;font-size:13px;">Reproduced from the authorization email, exactly as it was sent.</td></tr>
      ${authorizationDocumentHtml(booking)}
    </table>`;
}

export function renderSignatureConfirmation(
  evidence: SignatureEvidence,
  booking?: BookingAuthorizationData | null,
): RenderedSignatureConfirmation {
  // The booking number leads: these arrive in a stream alongside the other
  // internal notices and the number is what an operator scans for.
  const subject = `[${evidence.bookingNumber}] Customer signed the authorization`;

  const text = [
    `${evidence.customerName} has electronically signed the authorization for booking ${evidence.bookingNumber}.`,
    "",
    "The signed confirmation is attached as a PDF.",
    ...textSection("Booking", bookingRows(evidence)),
    "",
    "CUSTOMER CONSENT",
    // Quoted and indented, the only way to set a block apart in plain text.
    ...evidence.consentText
      .trim()
      .split("\n")
      .map((line) => `  "${line.trim()}"`),
    ...textSection("Customer security information", securityRows(evidence)),
    // The document itself, reproduced exactly as the authorization email
    // stated it. The signature above is only meaningful against what was
    // signed, so the covering note carries both or neither.
    ...(booking
      ? ["", "WHAT THE CUSTOMER SIGNED", "", ...authorizationDocumentText(booking)]
      : []),
    "",
    "The device, operating system, browser, screen size and browser time zone were reported by the customer's browser and are corroboration rather than proof. The IP address and the confirmation time were observed by the server.",
    "",
    "This is an internal record. The customer does not receive it.",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #dfe3e8;">
      <tr><td colspan="2" style="background:#0b1f44;padding:12px 20px;color:#ffffff;font-size:17px;">Customer signed the authorization</td></tr>
      <tr>
        <td colspan="2" style="padding:14px 20px 4px;color:#0b1f44;font-size:15px;font-weight:bold;">Booking ${escapeHtml(evidence.bookingNumber)}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:0 20px 10px;color:#5b6472;font-size:13px;">The signed confirmation is attached as a PDF.</td>
      </tr>
      ${htmlSection("Booking", bookingRows(evidence))}
      <tr>
        <td colspan="2" style="padding:18px 20px 4px;color:#5b6472;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid #eceef1;">Customer consent</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:4px 20px 0;">
          <div style="border-left:3px solid #0b1f44;background:#f8fafc;padding:10px 12px;color:#0b1f44;font-size:13px;line-height:1.5;font-style:italic;">${escapeHtml(evidence.consentText.trim())}</div>
        </td>
      </tr>
      ${htmlSection("Customer security information", securityRows(evidence))}
      <tr>
        <td colspan="2" style="padding:18px 20px;color:#8a919c;font-size:11px;border-top:1px solid #eceef1;">
          The device, operating system, browser, screen size and browser time zone were reported by the customer's browser and are corroboration rather than proof. The IP address and the confirmation time were observed by the server. This is an internal record; the customer does not receive it.
        </td>
      </tr>
    </table>
    ${documentTable(booking)}
  </body>
</html>`;

  return { subject, text, html };
}

/** `authorization-GX1234.pdf` — recognisable in an attachment list. */
export function confirmationFilename(bookingNumber: string): string {
  const safe = bookingNumber.replace(/[^A-Za-z0-9-]/g, "") || "booking";

  return `authorization-${safe}.pdf`;
}
