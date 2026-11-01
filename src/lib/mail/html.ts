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

/**
 * The composed itinerary, flattened for the plain-text part of a message.
 *
 * A text-only client, a screen reader and a spam filter all read that part, so
 * an itinerary present in the HTML and absent from the text would read as a
 * message with nothing in it. Deliberately crude — block tags become line
 * breaks, list items gain a dash, everything else is dropped. An image cannot
 * be flattened at all, so it is named rather than silently lost; the bytes are
 * still attached to the message either way.
 */
export function htmlToPlainText(html: string): string[] {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<img\b[^>]*>/gi, "\n[image attached]\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Last, so an escaped entity in the source cannot be decoded twice.
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The itinerary block, as table rows, or nothing at all.
 *
 * One definition, used by the authorization email and the e-ticket, so the
 * customer sees the same itinerary presented the same way in the message that
 * asks them to authorize the charge and in the one that confirms it.
 *
 * `html` is embedded rather than escaped — it is sanitised markup from
 * `sanitiseRichText`, relocated by `prepareItineraryForEmail` — and that is
 * the whole reason this helper is separate from `bulletList` below, which
 * escapes everything it is given.
 */
export function itinerarySection(html: string | null | undefined): string {
  if (!html?.trim()) return "";

  return `
  ${sectionHeading("Itinerary")}
  <tr><td style="padding:16px 20px;font-size:13px;color:#333333;line-height:1.6;">${html}</td></tr>`;
}

export function bulletList(items: readonly string[]): string {
  return `<ul style="margin:0;padding-left:20px;font-size:13px;color:#444444;line-height:1.6;">${items
    .map((item) => `<li style="margin-bottom:6px;">${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
}
