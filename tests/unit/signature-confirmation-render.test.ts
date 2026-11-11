import { beforeAll, describe, expect, it } from "vitest";

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

  it("escapes a value that would otherwise be markup", () => {
    const { html } = renderSignatureConfirmation({
      ...EVIDENCE,
      signatureName: '<img src=x onerror="alert(1)">',
    });

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
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
