import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import {
  authorizationSections,
  type AuthorizationTableSection,
  type BookingAuthorizationData,
} from "@/lib/mail/booking-authorization";
import { htmlToPlainText } from "@/lib/mail/html";
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

/**
 * The itinerary as lines the document can draw.
 *
 * `[image attached]` is dropped: `htmlToPlainText` emits it for an email, where
 * the bytes really are attached to the message. Nothing is attached to a PDF,
 * so printing it here would point at a file that does not exist.
 */
function itineraryLines(html: string | null | undefined): string[] {
  const composed = html?.trim();
  if (!composed) return [];

  return htmlToPlainText(composed).filter((line) => line !== "[image attached]");
}

export async function renderConfirmationPdf(
  evidence: SignatureEvidence,
  /**
   * The booking as the authorization email stated it.
   *
   * Optional: a signature whose booking can no longer be read still produces a
   * document, because the signature and the consent wording are the part that
   * has to survive. The sections it adds are what the customer was shown.
   */
  booking?: BookingAuthorizationData | null,
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
    // Enough for the heading, its rule and the first two lines under it: a
    // heading alone at the foot of a page reads as a section with nothing in
    // it, which in an evidence document invites exactly the wrong question.
    ensure(76);
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

  /**
   * A columned table, sized to its own contents.
   *
   * Column widths come from the widest cell in each column rather than a fixed
   * split: a traveller table is one narrow number, two long names and two
   * dates, and an even split would wrap the names while leaving the index
   * column mostly empty. The natural widths are then scaled to the text block,
   * up or down, so the table always spans the page exactly once.
   */
  const table = (section: AuthorizationTableSection): void => {
    const available = PAGE.width - MARGIN * 2;
    const size = 9;
    const gutter = 10;

    if (section.rows.length === 0) {
      paragraph(section.empty, size);
      return;
    }

    const natural = section.columns.map((column, index) =>
      Math.max(
        fonts.bold.widthOfTextAtSize(column, size),
        ...section.rows.map((row) =>
          fonts.body.widthOfTextAtSize(row[index] ?? "", size),
        ),
      ),
    );

    const spread = natural.reduce((sum, width) => sum + width, 0);
    const room = available - gutter * (section.columns.length - 1);

    // Leftover room is shared equally rather than proportionally: scaling up
    // would hand almost all of it to the widest column — the names — and leave
    // a gulf before the next heading. Only an over-wide table is scaled down,
    // where proportion is what keeps every column readable.
    const widths =
      spread <= room
        ? natural.map((width) => width + (room - spread) / section.columns.length)
        : natural.map((width) => (width / spread) * room);

    const offsets = widths.map((_, index) =>
      widths
        .slice(0, index)
        .reduce((sum, width) => sum + width + gutter, MARGIN),
    );

    const drawRow = (cells: readonly string[], font: PDFFont, color = INK) => {
      const wrapped = cells.map((cell, index) =>
        wrap(cell, font, size, widths[index] ?? available),
      );
      const height = Math.max(...wrapped.map((lines) => lines.length));

      ensure(height * 12 + 6);

      wrapped.forEach((lines, index) => {
        lines.forEach((line, row) => {
          cursor.page.drawText(line, {
            x: offsets[index] ?? MARGIN,
            y: cursor.y - row * 12,
            size,
            font,
            color,
          });
        });
      });

      cursor.y -= height * 12 + 4;
    };

    drawRow(section.columns, fonts.bold, MUTED);

    cursor.y += 2;
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y },
      end: { x: PAGE.width - MARGIN, y: cursor.y },
      thickness: 0.5,
      color: RULE,
    });
    cursor.y -= 12;

    section.rows.forEach((row) => drawRow(row, fonts.body));
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
    `Electronically signed for booking ${evidence.bookingNumber}. This document records the authorization the customer gave, ${booking ? "the booking it was given against, " : ""}the exact wording they agreed to, and the technical details observed at the moment they confirmed it.`,
    9,
  );

  heading("Booking");
  bookingRows(evidence).forEach(field);

  // What was signed, before how it was signed. The tables are the customer's
  // own copy of the authorization reproduced in the record, so the document
  // stands on its own in a chargeback rather than referring back to an email.
  if (booking) {
    for (const section of authorizationSections(booking)) {
      heading(section.title);

      if (section.kind === "table") {
        table(section);
        continue;
      }

      section.rows.forEach(([label, value]) => field({ label, value }));

      if (section.note) {
        cursor.y -= 4;
        paragraph(section.note, 9);
      }

      if (section.statement) {
        cursor.y -= 4;
        paragraph(section.statement, 9);
      }
    }

    const itinerary = itineraryLines(booking.itineraryHtml);

    if (itinerary.length > 0) {
      heading("Itinerary");
      itinerary.forEach((line) => paragraph(line, 9));
    }
  }

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
