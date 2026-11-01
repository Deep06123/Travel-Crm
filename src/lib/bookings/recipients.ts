/**
 * Who a booking's customer-facing email goes to.
 *
 * One rule, in one place. It was previously restated at every send and preview
 * site — the authorization email, the e-ticket, the lifecycle mail and the
 * booking page's own "would be sent to" label — which is four chances for the
 * UI to promise one address and the mailer to use another.
 *
 * The billing section's Email IDs win. They are the addresses the operator
 * entered against the card being charged, so they are the ones the cardholder
 * expects paperwork on; `contactEmail` and the customer record stand behind
 * them for bookings that have no billing addresses recorded.
 *
 * Note what this means for the authorization email: its link is a bearer
 * token, so every address returned here can sign for the card. That is the
 * intended behaviour — the Email IDs field is a deliberate operator entry, not
 * an inferred list — but it is the reason this is documented rather than
 * inlined somewhere as a `||` chain.
 */

/** The fields any caller must select to resolve a recipient. */
export interface RecipientSource {
  contactEmail: string | null;
  /** Comma-separated, straight from the billing section. */
  billingEmails: string | null;
  customer: { email: string | null };
}

/** Splits the stored comma list, dropping blanks and case-insensitive repeats. */
function parseList(value: string | null): string[] {
  if (!value) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of value.split(",")) {
    const address = part.trim();
    if (address === "") continue;

    const key = address.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(address);
  }

  return out;
}

/**
 * Every address a booking's email should reach, in order.
 *
 * Empty when the booking has nowhere to send to, which callers treat as a
 * suppression rather than an error: a booking with no addresses on it is a
 * data gap, not a failure of the mail transport.
 */
export function bookingRecipients(booking: RecipientSource): string[] {
  const billing = parseList(booking.billingEmails);
  if (billing.length > 0) return billing;

  const contact = booking.contactEmail?.trim();
  if (contact) return [contact];

  const customer = booking.customer.email?.trim();
  if (customer) return [customer];

  return [];
}

/**
 * The same addresses as one header value.
 *
 * Comma-separated, which is what SMTP expects in a `To:` and what the
 * `recipient` columns store. Empty string when there is nobody to send to, so
 * it can be rendered directly into a label.
 */
export function bookingRecipientLine(booking: RecipientSource): string {
  return bookingRecipients(booking).join(", ");
}
