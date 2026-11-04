import { escapeHtml } from "./html";

/**
 * The internal copy that tells the business something went out.
 *
 * Deliberately not built from `templates.ts`. Those messages are addressed to
 * a customer: they carry the policy blocks, the itinerary and the branding,
 * and they are written in the second person. This one is addressed to the
 * operator's own mailbox and its whole job is to be skimmable in a list — what
 * happened, on which booking, to whom, when.
 *
 * What it does *not* carry is as deliberate. It is a notice, not a copy of the
 * customer's document: no itinerary, no passenger list, no card detail beyond
 * what already names the booking. Anyone who needs the document can open the
 * booking, which is what the link is for; forwarding one internal notice must
 * not forward a traveller's personal data with it.
 */

/** One `label: value` line in the notice body. */
export interface AdminNoticeRow {
  label: string;
  value: string | null;
}

export interface AdminNoticeData {
  /** The sentence at the top, e.g. "Authorization email sent". */
  headline: string;
  bookingNumber: string;
  /** Deep link to the booking, when the deployment knows its own address. */
  bookingUrl?: string | null;
  rows: readonly AdminNoticeRow[];
  /** Optional closing sentence, for context a row cannot carry. */
  footnote?: string | null;
}

export interface RenderedAdminNotice {
  subject: string;
  text: string;
  html: string;
}

/** Rows with nothing in them are dropped rather than printed as "—". */
function presentRows(rows: readonly AdminNoticeRow[]): AdminNoticeRow[] {
  return rows.filter((row) => Boolean(row.value?.trim()));
}

export function renderAdminNotice(data: AdminNoticeData): RenderedAdminNotice {
  const rows = presentRows(data.rows);

  // The booking number leads, because these arrive in a stream and the number
  // is what an operator scans for.
  const subject = `[${data.bookingNumber}] ${data.headline}`;

  const textLines = [
    data.headline,
    "",
    ...rows.map((row) => `${row.label}: ${row.value}`),
  ];

  if (data.bookingUrl) {
    textLines.push("", `Open the booking: ${data.bookingUrl}`);
  }

  if (data.footnote) {
    textLines.push("", data.footnote);
  }

  textLines.push(
    "",
    "This is an internal notification. The customer does not receive it.",
  );

  const rowHtml = rows
    .map(
      (row) => `
        <tr>
          <td style="padding:6px 20px;color:#5b6472;font-size:13px;width:40%;vertical-align:top;">${escapeHtml(row.label)}</td>
          <td style="padding:6px 20px;color:#0b1f44;font-size:13px;font-weight:bold;vertical-align:top;">${escapeHtml(row.value ?? "")}</td>
        </tr>`,
    )
    .join("");

  const linkHtml = data.bookingUrl
    ? `<tr><td colspan="2" style="padding:14px 20px 4px;">
         <a href="${escapeHtml(data.bookingUrl)}" style="background:#0b1f44;color:#ffffff;font-size:13px;text-decoration:none;padding:9px 16px;border-radius:4px;display:inline-block;">Open the booking</a>
       </td></tr>`
    : "";

  const footnoteHtml = data.footnote
    ? `<tr><td colspan="2" style="padding:12px 20px 0;color:#5b6472;font-size:12px;">${escapeHtml(data.footnote)}</td></tr>`
    : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #dfe3e8;">
      <tr><td colspan="2" style="background:#0b1f44;padding:12px 20px;color:#ffffff;font-size:17px;">${escapeHtml(data.headline)}</td></tr>
      <tr>
        <td colspan="2" style="padding:14px 20px 4px;color:#0b1f44;font-size:15px;font-weight:bold;">Booking ${escapeHtml(data.bookingNumber)}</td>
      </tr>
      ${rowHtml}
      ${linkHtml}
      ${footnoteHtml}
      <tr>
        <td colspan="2" style="padding:18px 20px;color:#8a919c;font-size:11px;border-top:1px solid #eceef1;">
          This is an internal notification sent to the addresses configured in Settings. The customer does not receive it.
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text: textLines.join("\n"), html };
}
