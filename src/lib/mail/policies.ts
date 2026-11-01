import { bulletList, escapeHtml, sectionHeading } from "./html";

/**
 * The terms printed at the foot of a customer-facing booking email.
 *
 * One copy, used by both the authorization email and the e-ticket. These are
 * the rules a customer is held to when a change, a refund or a no-show comes
 * up months later, and the two messages disagreeing about them is precisely
 * the discrepancy an argument turns on — so neither template keeps its own
 * version.
 *
 * A handful of lines are tense-dependent: the authorization email is sent
 * before the card is charged and before the tickets exist, the e-ticket after
 * both. Those are written out per document rather than hedged into wording
 * that fits neither — a customer reading "your e-tickets will arrive in a
 * separate email" *on* their e-ticket goes looking for an email that is never
 * coming. Every substantive rule is identical between the two.
 */

/** Which message the terms are being printed in. */
export type PolicyDocument = "authorization" | "eticket";

/** The three editable sections, keyed the way the settings page stores them. */
export type PolicySection = "bookingPolicy" | "changeRules" | "travelRules";

/**
 * Operator-supplied replacements, per section, from Settings.
 *
 * A section is either overridden wholesale or left alone — there is no merging
 * with the defaults below. Partial by design: overriding Change Rules is the
 * common case and should not force an operator to re-type the other two.
 *
 * Note what an override costs. The defaults vary four lines by tense, because
 * the authorization email is sent before the card is charged and the e-ticket
 * after. One stored list cannot do that, so an overridden section prints
 * identically in both messages and it falls to whoever wrote it to pick
 * wording that is true of both. The settings page says so where it is edited.
 */
export type PolicyOverrides = Partial<Record<PolicySection, readonly string[]>>;

function bookingPolicy(document: PolicyDocument): string[] {
  const beforeTheCharge = document === "authorization";

  return [
    beforeTheCharge
      ? "Cards will be charged only after we receive your authorization from the cardholder."
      : "Your card was charged only after we received your authorization from the cardholder.",
    beforeTheCharge
      ? "You will receive your e-tickets and carrier confirmation in a separate email."
      : "Your e-tickets and carrier confirmation are set out in this email.",
    beforeTheCharge
      ? "Tickets are issued once the payment has been successfully processed."
      : "Tickets are issued once the payment has been successfully processed, as it has been for this booking.",
    beforeTheCharge
      ? "If you do not receive an email or call within 24 hours of making this reservation, please contact us."
      : "If any detail above is wrong, contact us immediately — corrections made later may not be permitted.",
    "We strongly recommend all travellers confirm the status of their flight at least 24–48 hours before departure.",
  ];
}

export const CHANGE_RULES = [
  "Travel itinerary changes, if permitted by the airline fare rules, may incur a change fee imposed by the airline, which can vary by market, carrier and fare conditions. An administrative fee may also apply.",
  "Name changes are not permitted under any circumstances.",
  "Tickets are generally non-refundable unless the airline's fare rules say otherwise. On a refundable ticket the airline may apply a cancellation penalty as per its fare rules.",
  "Refunds, where applicable, are processed from the date the cancellation request is created and are issued in the same form of payment used at the time of booking.",
  "No refunds are provided in the case of a no-show.",
];

function travelRules(document: PolicyDocument): string[] {
  return [
    "All passengers must hold the valid travel documents, including a valid passport and any necessary visas, at the time of travel.",
    "Please review your tickets and itinerary carefully on receipt. All times shown are local time.",
    "Arrive at the airport at least 3 hours before an international departure and 2 hours before a domestic one.",
    "All international flights should be reconfirmed at least 72 hours prior to departure.",
    "Tickets submitted for refund or reissue are subject to the applicable airline charges, if any.",
    "We do not assume responsibility for, and will not compensate passengers for, travel interruptions caused by circumstances beyond our control, including acts of God or changes made by airlines, hotels, cruise companies or tour operators.",
    "We strongly advise all customers to purchase travel insurance and to review the terms and conditions applicable to their tickets.",
    document === "authorization"
      ? "Please keep a copy of this email for your records. It serves as confirmation of your booking request; the e-ticket receipt will be sent shortly."
      : "Please keep a copy of this email for your records. It is your e-ticket receipt.",
  ];
}

/**
 * The built-in wording for one section.
 *
 * Exported so the settings page can show an operator what they are replacing,
 * and restore it, without keeping a second copy of these sentences.
 */
export function defaultPolicyLines(
  section: PolicySection,
  document: PolicyDocument,
): readonly string[] {
  switch (section) {
    case "bookingPolicy":
      return bookingPolicy(document);
    case "changeRules":
      return CHANGE_RULES;
    case "travelRules":
      return travelRules(document);
  }
}

/** The heading each section is printed under. */
export function policySectionHeading(
  section: PolicySection,
  isCruise: boolean,
): string {
  switch (section) {
    case "bookingPolicy":
      return "Booking Policy";
    case "changeRules":
      return "Change Rules";
    case "travelRules":
      return isCruise
        ? "Cruise Rules and Restrictions"
        : "Flight Rules and Restrictions";
  }
}

export interface PolicyOptions {
  /**
   * Which message these terms are being printed in.
   *
   * Changes the tense of the four lines that describe where the booking has
   * got to, and nothing else.
   */
  document: PolicyDocument;
  /** Titles the last section, and nothing else — the rules themselves match. */
  isCruise: boolean;
  /**
   * What the operator has rewritten in Settings, if anything.
   *
   * Required rather than optional so every caller has to have fetched it. An
   * email that silently printed the built-in terms because a service forgot to
   * load the overrides is the failure worth making impossible here: the
   * customer would be held to wording the business thinks it replaced.
   */
  overrides: PolicyOverrides;
  /**
   * Repeated in the closing line, as in the header.
   *
   * Omitted entirely when the booking has no TFN, rather than printing "Call
   * us @" with nothing after it.
   */
  supportPhone?: string | null;
}

/**
 * The three policy sections and the closing call-us line, as table rows.
 *
 * Returns rows rather than a table, so the caller drops it into the bottom of
 * its own layout table — both messages are a single-column table and nesting
 * another one inside would change the spacing in Outlook.
 */
export function renderPolicySections({
  document,
  isCruise,
  supportPhone,
  overrides,
}: PolicyOptions): string {
  const phone = supportPhone?.trim();

  // An override of `[]` means the operator emptied the box, which drops the
  // section rather than falling back to the default: a business that deletes
  // its change rules has said something, and quietly reprinting them would
  // contradict it.
  const section = (key: PolicySection): string => {
    const lines = overrides[key] ?? defaultPolicyLines(key, document);
    if (lines.length === 0) return "";

    return `
  ${sectionHeading(policySectionHeading(key, isCruise))}
  <tr><td style="padding:16px 20px;">${bulletList(lines)}</td></tr>`;
  };

  return `
  ${section("bookingPolicy")}

  ${section("changeRules")}

  ${section("travelRules")}

  ${
    phone
      ? `<tr><td style="padding:16px 20px;border-top:1px solid #e5e7eb;text-align:center;">
    <div style="font-size:15px;font-weight:bold;color:#333333;">We are open 24x7 — Call us @ <span style="color:#0000cc;">${escapeHtml(phone)}</span></div>
  </td></tr>`
      : ""
  }`;
}
