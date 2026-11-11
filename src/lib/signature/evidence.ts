import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/financial/money";

/**
 * What a signed authorization amounts to, in one shape.
 *
 * The PDF and the email are two renderings of the same facts, and the facts
 * are the evidence. Keeping them in one structure is what stops the two
 * drifting — a field added to the attachment but not the message body would
 * mean the covering email no longer describes the document attached to it,
 * which is exactly the discrepancy a dispute is argued over.
 *
 * Nothing here is derived from the browser at render time. Every value was
 * either observed by the server or claimed by the client *at signing* and
 * written to `BookingSignature`; this module only reads it back.
 */

export interface SignatureEvidence {
  signatureId: string;
  bookingNumber: string;
  customerName: string;
  product: string;
  totalMinor: number;
  currency: string;

  /** The typed name the customer authorized under. */
  signatureName: string;
  /** The mobile number they confirmed on the signing page. */
  signedPhone: string;
  /** The exact wording shown and agreed to, verbatim. */
  consentText: string;
  /** Where the invitation was sent. */
  recipientEmail: string;

  /** When the link was first opened. Null if it was signed without a prior view. */
  viewedAt: Date | null;
  /** The server's clock at the moment of signing. Never the browser's. */
  signedAt: Date;

  ipAddress: string | null;
  device: string | null;
  operatingSystem: string | null;
  browser: string | null;
  screenSize: string | null;
  clientTimezone: string | null;
  geoCity: string | null;
  geoRegion: string | null;
  geoCountry: string | null;
}

/** One labelled line. `value` is already formatted and never empty. */
export interface EvidenceRow {
  label: string;
  value: string;
}

/**
 * Said out loud rather than left blank.
 *
 * An empty cell in a security record reads as "nothing happened there", when
 * what actually happened is that the browser declined to say or no provider
 * was configured. The distinction matters when the document is being read as
 * evidence, so the absence is printed.
 */
export const UNAVAILABLE = "Not available";

function present(value: string | null | undefined): string {
  return value?.trim() || UNAVAILABLE;
}

/** The approximate place, as one line, or `null` if nothing was resolved. */
export function locationLine(evidence: SignatureEvidence): string | null {
  const parts = [evidence.geoCity, evidence.geoRegion, evidence.geoCountry]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * The nine security fields, in a fixed order, always all nine.
 *
 * Fixed because the order is how a reader compares one record against
 * another, and always all nine because a shorter list is indistinguishable
 * from a list that had nothing to report.
 */
export function securityRows(evidence: SignatureEvidence): EvidenceRow[] {
  return [
    { label: "IP Address", value: present(evidence.ipAddress) },
    { label: "Device", value: present(evidence.device) },
    { label: "Operating System", value: present(evidence.operatingSystem) },
    { label: "Browser", value: present(evidence.browser) },
    { label: "Screen Size", value: present(evidence.screenSize) },
    { label: "Browser Timezone", value: present(evidence.clientTimezone) },
    {
      label: "Opened",
      value: evidence.viewedAt
        ? formatDateTime(evidence.viewedAt)
        : "Not recorded — signed without the link being opened first",
    },
    { label: "Confirmed At", value: formatDateTime(evidence.signedAt) },
    { label: "Approximate Location", value: present(locationLine(evidence)) },
  ];
}

/** What was signed, as opposed to how it was signed. */
export function bookingRows(evidence: SignatureEvidence): EvidenceRow[] {
  return [
    { label: "Booking Reference", value: evidence.bookingNumber },
    { label: "Customer", value: evidence.customerName },
    { label: "Product", value: evidence.product },
    {
      label: "Total",
      value: formatMoney(evidence.totalMinor, evidence.currency),
    },
    { label: "Signed As", value: evidence.signatureName },
    { label: "Mobile Confirmed", value: evidence.signedPhone },
    { label: "Invitation Sent To", value: evidence.recipientEmail },
  ];
}
