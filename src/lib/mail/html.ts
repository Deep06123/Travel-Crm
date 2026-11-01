/**
 * The small HTML pieces every customer-facing email is built from.
 *
 * Extracted from `eticket.ts` once the e-ticket, the authorization email and
 * the shared policy block all needed them: three copies of an escape function
 * is three chances for one of them to be the lenient one.
 *
 * Tables and inline styles throughout, because Outlook ignores flexbox, grid
 * and most of a `<style>` block.
 */

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

/** The navy bar that separates one section of a message from the next. */
export function sectionHeading(title: string): string {
  return `<tr><td style="background:#0b1f44;padding:12px 20px;color:#ffffff;font-size:17px;font-weight:normal;">${escapeHtml(title)}</td></tr>`;
}

export function bulletList(items: readonly string[]): string {
  return `<ul style="margin:0;padding-left:20px;font-size:13px;color:#444444;line-height:1.6;">${items
    .map((item) => `<li style="margin-bottom:6px;">${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
}
