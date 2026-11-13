import { beforeAll, describe, expect, it } from "vitest";

import { CardType } from "@/generated/prisma/enums";
import type { BookingAuthorizationData } from "@/lib/mail/booking-authorization";
import {
  confirmationFilename,
  renderSignatureConfirmation,
} from "@/lib/mail/signature-confirmation";
import { renderConfirmationPdf } from "@/lib/pdf/signature-confirmation";
import {
  securityRows,
  UNAVAILABLE,
  type SignatureEvidence,
} from "@/lib/signature/evidence";

import { pdfPageCount, pdfText } from "../helpers/pdf-text";

/**
 * The two renderings of a signed authorization: the covering email and the
 * document attached to it.
 *
 * Both are asserted against the same evidence, because the property that
 * matters is that they agree — a field present in one and missing from the
 * other means the message no longer describes its own attachment.
 */

const EVIDENCE: SignatureEvidence = {
  signatureId: "sig_test",
  bookingNumber: "GX-2048",
  customerName: "Grace Hopper",
  product: "FLIGHT",
  totalMinor: 102_997,
  currency: "USD",
  signatureName: "Grace Hopper",
  signedPhone: "+1 555 0100",
  consentText:
    "I confirm that I have reviewed the booking details and authorize the charge to my card.",
  recipientEmail: "grace@example.invalid",
  viewedAt: new Date("2026-05-01T09:00:00Z"),
  signedAt: new Date("2026-05-01T09:12:00Z"),
  ipAddress: "203.0.113.9",
  device: "Windows PC",
  operatingSystem: "Win32",
  browser: "Google Chrome",
  screenSize: "1920 x 1080",
  clientTimezone: "Europe/London",
  geoCity: "Leeds",
  geoRegion: "England",
  geoCountry: "United Kingdom",
};

/** Nothing the browser was willing to say, and no provider configured. */
const BARE: SignatureEvidence = {
  ...EVIDENCE,
  viewedAt: null,
  ipAddress: null,
  device: null,
  operatingSystem: null,
  browser: null,
  screenSize: null,
  clientTimezone: null,
  geoCity: null,
  geoRegion: null,
  geoCountry: null,
};

/** The booking as the authorization email stated it, quoted by the covering note. */
const BOOKING: BookingAuthorizationData = {
  bookingNumber: "GX-2048",
  customerName: "Grace Hopper",
  product: "FLIGHT",
  currency: "USD",
  totalMinor: 102_997,
  travelStartDate: new Date("2026-06-01T00:00:00Z"),
  airlineConfirmation: "ABC123",
  policyOverrides: {},
  supportPhone: "+1-888-480-7222",
  segments: [],
  cruise: null,
  passengers: [
    {
      firstName: "Ada",
      lastName: "Lovelace",
      gender: "Female",
      dateOfBirth: new Date("1990-12-10T00:00:00Z"),
      ticketNumber: "1234567890",
    },
  ],
  itineraryHtml: "<p><strong>Depart 10:00</strong> JFK to LHR</p>",
  bookedAt: new Date("2026-04-28T12:00:00Z"),
  contactEmail: "grace@example.invalid",
  contactPhone: "+1 555 0100",
  cardHolderName: "Grace Hopper",
  cardType: CardType.VISA,
  cardLast4: "1111",
  billingAddress: "12 Example Street, Leeds, LS1 1AA, United Kingdom",
  chargeSplits: [
    { title: "Deposit", amountMinor: 50_000 },
    { title: "Balance", amountMinor: 52_997 },
  ],
  sailing: null,
};

beforeAll(() => {
  // `formatDateTime` renders in the business time zone, so the assertions
  // below need it pinned rather than inherited from the machine.
  process.env.TZ = "UTC";
});

describe("the security section", () => {
  it("lists all nine fields, in order", () => {
    expect(securityRows(EVIDENCE).map((row) => row.label)).toEqual([
      "IP Address",
      "Device",
      "Operating System",
      "Browser",
      "Screen Size",
      "Browser Timezone",
      "Opened",
      "Confirmed At",
      "Approximate Location",
    ]);
  });

  it("says a field is unavailable rather than leaving it blank", () => {
    const rows = securityRows(BARE);

    // A blank cell reads as "nothing happened"; the truth is that nothing was
    // reported, and the document has to say which.
    expect(rows.every((row) => row.value.trim() !== "")).toBe(true);
    expect(rows.find((row) => row.label === "IP Address")?.value).toBe(UNAVAILABLE);
    expect(rows.find((row) => row.label === "Browser")?.value).toBe(UNAVAILABLE);
    expect(rows.find((row) => row.label === "Approximate Location")?.value).toBe(
      UNAVAILABLE,
    );

    // Still a real time, because the server clock supplied it.
    expect(rows.find((row) => row.label === "Confirmed At")?.value).not.toBe(
      UNAVAILABLE,
    );
  });

  it("distinguishes never opened from opened at an unknown time", () => {
    expect(securityRows(BARE).find((row) => row.label === "Opened")?.value).toMatch(
      /without the link being opened/,
    );
  });

  it("joins only the parts of a location that were resolved", () => {
    const partial = securityRows({ ...EVIDENCE, geoRegion: null });

    expect(
      partial.find((row) => row.label === "Approximate Location")?.value,
    ).toBe("Leeds, United Kingdom");
  });
});

describe("the confirmation email", () => {
  it("carries the consent wording verbatim and every security field", () => {
    const { subject, text, html } = renderSignatureConfirmation(EVIDENCE);

    expect(subject).toBe("[GX-2048] Customer signed the authorization");

    for (const part of [text, html]) {
      // The sentence a dispute turns on, reproduced rather than summarised.
      expect(part).toContain(EVIDENCE.consentText);

      expect(part).toContain("203.0.113.9");
      expect(part).toContain("Windows PC");
      expect(part).toContain("Win32");
      expect(part).toContain("Google Chrome");
      expect(part).toContain("1920 x 1080");
      expect(part).toContain("Europe/London");
      expect(part).toContain("Leeds, England, United Kingdom");
      // Cased differently in each part — the plain-text headings are
      // upper-cased, the HTML ones by stylesheet — so the section is matched
      // rather than its exact spelling.
      expect(part.toLowerCase()).toContain("customer security information");
    }
  });

  it("shows the signature the customer gave, as its own section", () => {
    const { text, html } = renderSignatureConfirmation(EVIDENCE);

    for (const part of [text, html]) {
      expect(part.toLowerCase()).toContain("customer signature");
      expect(part).toContain("Grace Hopper");
      expect(part).toContain("Electronic Signature");
      // Dated, so the mark is attributable to a moment and not only to a name.
      expect(part).toContain("Signed by Grace Hopper on");
    }

    // Set in a script face, as the signing page drew it — the point of the
    // section is to reproduce the mark, not to repeat the name in body text.
    expect(html).toContain("Brush Script MT");
  });

  it("falls back to the customer name when no typed name was captured", () => {
    const { text, html } = renderSignatureConfirmation({
      ...EVIDENCE,
      signatureName: "",
    });

    // An empty signature block would read as though nothing was signed.
    for (const part of [text, html]) {
      expect(part.toLowerCase()).toContain("customer signature");
      expect(part).toContain("Grace Hopper");
    }
  });

  it("escapes a value that would otherwise be markup", () => {
    const { html } = renderSignatureConfirmation({
      ...EVIDENCE,
      signatureName: '<img src=x onerror="alert(1)">',
    });

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("reproduces the tables the customer was sent, when the booking is given", () => {
    const { text, html } = renderSignatureConfirmation(EVIDENCE, BOOKING);

    for (const part of [text, html]) {
      // The traveller table.
      expect(part).toContain("Ada Lovelace");
      expect(part).toContain("1234567890");
      // The card authorization detail.
      expect(part).toContain("Grace Hopper");
      expect(part).toContain("12 Example Street");
      // The charges, split exactly as they were quoted.
      expect(part).toContain("Deposit");
      expect(part).toContain("Balance");
      // And the wording the customer agreed to with them.
      expect(part).toContain("I acknowledge receipt of this email");
    }

    // The itinerary travels as markup in the HTML part and flattened in the
    // text one, so it is asserted on its content rather than its tags.
    expect(html).toContain("<strong>Depart 10:00</strong>");
    expect(text).toContain("Depart 10:00");
  });

  it("still renders when the booking could not be loaded", () => {
    const { text, html } = renderSignatureConfirmation(EVIDENCE, null);

    // The evidence is the part that must never be lost.
    expect(text).toContain(EVIDENCE.consentText);
    expect(html).toContain("203.0.113.9");
    expect(html).not.toContain("What the customer signed");
  });

  it("names the attachment after the booking", () => {
    expect(confirmationFilename("GX-2048")).toBe("authorization-GX-2048.pdf");
    // Anything that could escape a directory or confuse a mail client is gone.
    expect(confirmationFilename("../../etc/passwd")).toBe("authorization-etcpasswd.pdf");
  });
});

describe("the confirmation PDF", () => {
  it("is a readable PDF carrying the consent wording and the security fields", async () => {
    const bytes = await renderConfirmationPdf(EVIDENCE);

    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1_000);

    // Asserted against what the document draws rather than what was passed
    // in: the point is that the value reached the page.
    const drawn = pdfText(bytes);

    expect(drawn).toContain("GX-2048");
    expect(drawn).toContain("CUSTOMER SECURITY INFORMATION");
    expect(drawn).toContain("203.0.113.9");
    expect(drawn).toContain("Europe/London");
    expect(drawn).toContain("Google Chrome");
    expect(drawn).toContain("1920 x 1080");
    expect(drawn).toContain("Windows PC");
    expect(drawn).toContain("Leeds, England, United Kingdom");

    // The consent sentence, word for word. Line breaks are the renderer's, so
    // it is compared with whitespace collapsed.
    expect(drawn.replace(/\s+/g, " ")).toContain(EVIDENCE.consentText);
  });

  it("draws the signature as its own section", async () => {
    const drawn = pdfText(await renderConfirmationPdf(EVIDENCE));

    expect(drawn.toUpperCase()).toContain("CUSTOMER SIGNATURE");
    expect(drawn).toContain("Grace Hopper");
    expect(drawn).toContain("Electronic Signature");
    expect(drawn.replace(/\s+/g, " ")).toContain("Signed by Grace Hopper on");
  });

  it("keeps the signature block whole rather than splitting it at a page break", async () => {
    // A name long enough to wrap inside the block, with the consent wording
    // pushed long enough to put the block near a page boundary.
    const bytes = await renderConfirmationPdf({
      ...EVIDENCE,
      signatureName: "Grace Brewster Murray Hopper-Vandenberg",
    });

    expect(pdfPageCount(bytes)).toBeGreaterThan(0);
    expect(pdfText(bytes).replace(/\s+/g, " ")).toContain(
      "Grace Brewster Murray Hopper-Vandenberg",
    );
  });

  it("carries the same tables as the email when the booking is given", async () => {
    const drawn = pdfText(await renderConfirmationPdf(EVIDENCE, BOOKING));

    for (const expected of [
      // The traveller table, header and row.
      "PASSENGER'S NAME",
      "E-TICKET NO.",
      "ADA LOVELACE",
      "1234567890",
      // The card authorization detail.
      "CREDIT CARD AUTHORIZATION DETAILS",
      "12 EXAMPLE STREET",
      // The charges, split as they were quoted.
      "TOTAL CHARGES & AUTHORIZATION",
      "DEPOSIT",
      "BALANCE",
      "$500.00",
      // The itinerary and the wording agreed to with it.
      "ITINERARY",
      "I ACKNOWLEDGE RECEIPT",
    ]) {
      expect(drawn.toUpperCase()).toContain(expected);
    }
  });

  it("renders without the booking, which may no longer exist", async () => {
    const bytes = await renderConfirmationPdf(EVIDENCE, null);

    // The evidence is what the document exists for and must survive alone.
    expect(pdfText(bytes)).toContain("203.0.113.9");
    expect(pdfText(bytes).toUpperCase()).not.toContain("E-TICKET NO.");
  });

  it("renders without any browser-reported detail", async () => {
    const bytes = await renderConfirmationPdf(BARE);

    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdfText(bytes)).toContain(UNAVAILABLE);
  });

  it("wraps a value too long for its column instead of running off the page", async () => {
    const bytes = await renderConfirmationPdf({
      ...EVIDENCE,
      // No spaces: the only way through this is to break mid-word.
      device: "A".repeat(400),
      consentText: `${EVIDENCE.consentText} ${"Further terms. ".repeat(120)}`,
    });

    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // Spilled onto a second page, which is the behaviour under test: it must
    // paginate rather than overdraw the bottom margin.
    expect(pdfPageCount(bytes)).toBeGreaterThan(1);

    // And the long value is still legible, broken across lines.
    expect(pdfText(bytes).replace(/\s+/g, "")).toContain("A".repeat(400));
  });
});
