import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import {
  bookingRows,
  securityRows,
  type EvidenceRow,
  type SignatureEvidence,
} from "@/lib/signature/evidence";

/**
 * The signed authorization, as a document.
 *
 * `pdf-lib` rather than a headless browser: this runs inside a request on a
 * small VPS, and launching Chromium to lay out two pages of label-and-value
 * would cost more memory than the rest of the application put together. The
 * standard fonts are embedded from the library's own tables, so there is no
 * filesystem read to survive Next's standalone bundling either.
 *
 * Deliberately plain. This is evidence, and a document that is read in a
 * dispute is better for being boring: no images, no colour beyond a rule and a
 * heading, nothing that depends on an asset being resolvable years from now.
 *
 * Pure: it takes the evidence and returns bytes. Storing them, and making sure
 * they are only ever generated once, is `signature-confirmation-service`.
 */

const PAGE = { width: 595.28, height: 841.89 } as const; // A4 at 72dpi.
const MARGIN = 56;
const INK = rgb(0.043, 0.122, 0.267);
const MUTED = rgb(0.357, 0.392, 0.447);
const RULE = rgb(0.874, 0.89, 0.909);

const LABEL_WIDTH = 170;

interface Cursor {
  page: PDFPage;
  y: number;
}

export interface ConfirmationPdfFonts {
  body: PDFFont;
  bold: PDFFont;
}

/**
 * Breaks a string to a width, by measurement rather than character count.
 *
 * The consent wording and a user-agent string are the two long values here and
 * neither has predictable word lengths, so a fixed character count would
 * either overflow the page or waste half of it.
 */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    let line = "";

    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;

      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) lines.push(line);

      // A single word wider than the column — a long address or a token-like
      // string. Split it rather than let it run off the page.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = "";
        for (const character of word) {
          if (font.widthOfTextAtSize(chunk + character, size) > maxWidth) {
            lines.push(chunk);
            chunk = character;
          } else {
            chunk += character;
          }
        }
        line = chunk;
      } else {
        line = word;
      }
    }

    lines.push(line);
  }

  return lines;
}

export async function renderConfirmationPdf(
  evidence: SignatureEvidence,
): Promise<Buffer> {
  const doc = await PDFDocument.create();

  doc.setTitle(`Authorization confirmation ${evidence.bookingNumber}`);
  doc.setSubject("Customer e-signature confirmation and security record");
  doc.setProducer("Travel CRM");
  doc.setCreationDate(evidence.signedAt);
  doc.setModificationDate(evidence.signedAt);

  const fonts: ConfirmationPdfFonts = {
    body: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  const cursor: Cursor = {
    page: doc.addPage([PAGE.width, PAGE.height]),
    y: PAGE.height - MARGIN,
  };

  /** Starts a fresh page when the next block will not fit on this one. */
  const ensure = (needed: number): void => {
    if (cursor.y - needed >= MARGIN) return;
    cursor.page = doc.addPage([PAGE.width, PAGE.height]);
    cursor.y = PAGE.height - MARGIN;
  };

  const heading = (text: string): void => {
    ensure(40);
    cursor.y -= 18;
    cursor.page.drawText(text.toUpperCase(), {
      x: MARGIN,
      y: cursor.y,
      size: 9,
      font: fonts.bold,
      color: MUTED,
    });
    cursor.y -= 8;
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y },
      end: { x: PAGE.width - MARGIN, y: cursor.y },
      thickness: 0.75,
      color: RULE,
    });
    cursor.y -= 14;
  };

  const field = (row: EvidenceRow): void => {
    const valueWidth = PAGE.width - MARGIN * 2 - LABEL_WIDTH;
    const lines = wrap(row.value, fonts.body, 10, valueWidth);

    ensure(lines.length * 13 + 6);

    cursor.page.drawText(row.label, {
      x: MARGIN,
      y: cursor.y,
      size: 10,
      font: fonts.body,
      color: MUTED,
    });

    lines.forEach((line, index) => {
      cursor.page.drawText(line, {
        x: MARGIN + LABEL_WIDTH,
        y: cursor.y - index * 13,
        size: 10,
        font: fonts.bold,
        color: INK,
      });
    });

    cursor.y -= lines.length * 13 + 5;
  };

  const paragraph = (text: string, size = 10): void => {
    const lines = wrap(text, fonts.body, size, PAGE.width - MARGIN * 2);
    ensure(lines.length * (size + 4) + 6);

    lines.forEach((line, index) => {
      cursor.page.drawText(line, {
        x: MARGIN,
        y: cursor.y - index * (size + 4),
        size,
        font: fonts.body,
        color: INK,
      });
    });

    cursor.y -= lines.length * (size + 4) + 6;
  };

  cursor.page.drawText("Booking Authorization Confirmation", {
    x: MARGIN,
    y: cursor.y,
    size: 18,
    font: fonts.bold,
    color: INK,
  });
  cursor.y -= 20;

  paragraph(
    `Electronically signed for booking ${evidence.bookingNumber}. This document records the authorization the customer gave, the exact wording they agreed to, and the technical details observed at the moment they confirmed it.`,
    9,
  );

  heading("Booking");
  bookingRows(evidence).forEach(field);

  heading("Customer consent");
  // Verbatim and unwrapped in meaning — only the lines are broken. This
  // sentence is what a dispute turns on, so it is reproduced exactly as it was
  // shown rather than summarised into a field.
  paragraph(evidence.consentText);

  heading("Customer security information");
  securityRows(evidence).forEach(field);

  heading("About this record");
  paragraph(
    "Times are shown in the business time zone. The IP address, the confirmation time and the invitation details were observed by the server. The device, operating system, browser, screen size and browser time zone were reported by the customer's browser and are corroboration rather than proof. The approximate location is derived from the IP address and is indicative only.",
    9,
  );

  // Node's Buffer rather than the Uint8Array pdf-lib returns: everything
  // downstream — the storage adapter and the mail attachment — is typed for a
  // Buffer, and converting once here keeps the conversion out of both.
  //
  // Object streams off. They would shave a few hundred bytes off a document
  // that is two pages of text, at the cost of packing the page tree into a
  // compressed blob — and this is evidence, which is worth being able to
  // inspect with a text editor and a decompressor rather than only with a
  // reader that implements the whole format.
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
