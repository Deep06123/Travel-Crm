import { inflateSync } from "node:zlib";

/**
 * The words a PDF actually draws.
 *
 * pdf-lib compresses each page's content stream, so searching the raw bytes
 * for a value finds nothing and proves nothing. This inflates every
 * FlateDecode stream and pulls the literal strings back out of the `Tj`
 * operators, which is enough to assert that a field reached the page.
 *
 * Not a PDF parser and not trying to be. It makes no attempt at text
 * positioning, font encodings beyond the standard Latin set, or hex strings —
 * the document under test is Helvetica and ASCII, and a general parser here
 * would be a second implementation to keep correct.
 */
export function pdfText(bytes: Buffer): string {
  const pieces: string[] = [];

  // `stream` … `endstream`. The newline before `endstream` is part of the
  // syntax, not the data — but compressed data can itself end in `0x0A`, so
  // stripping it unconditionally truncates the stream and inflation fails.
  // It is captured and then tried both ways instead.
  const pattern = /[^d]stream\r?\n([\s\S]*?)endstream/g;

  for (const match of bytes.toString("latin1").matchAll(pattern)) {
    pieces.push(drawnStrings(decode(match[1]!)));
  }

  return pieces.join("\n");
}

/**
 * Inflates a captured stream, trying it with and without its final newline.
 *
 * Falls back to the bytes as they stand: an uncompressed stream still has its
 * literal strings in it.
 */
function decode(captured: string): string {
  const raw = Buffer.from(captured, "latin1");
  const trimmed = raw.subarray(0, raw.length - (captured.endsWith("\r\n") ? 2 : 1));

  for (const candidate of [trimmed, raw]) {
    try {
      return inflateSync(candidate).toString("latin1");
    } catch {
      // Try the other framing, then give up and read it raw.
    }
  }

  return captured;
}

/**
 * The strings a content stream draws, in order.
 *
 * Both PDF string forms are handled. pdf-lib writes hex — `<48656C6C6F> Tj` —
 * but the literal form is equally valid and a different writer would use it,
 * so reading only one would make this helper quietly wrong the day the
 * renderer changes.
 */
function drawnStrings(content: string): string {
  const out: string[] = [];

  for (const match of content.matchAll(
    /(?:<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\()])*)\))\s*Tj/g,
  )) {
    const [, hex, literal] = match;

    if (hex !== undefined) {
      out.push(fromHex(hex));
      continue;
    }

    out.push(
      literal!
        .replace(/\\([()\\])/g, "$1")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        // Octal escapes, which is how a non-ASCII character is written.
        .replace(/\\([0-7]{1,3})/g, (_, code: string) =>
          String.fromCharCode(parseInt(code, 8)),
        ),
    );
  }

  return out.join("\n");
}

/** WinAnsi, one byte per character — the encoding the standard fonts use. */
function fromHex(hex: string): string {
  const digits = hex.replace(/\s+/g, "");

  return Buffer.from(
    digits.length % 2 === 0 ? digits : `${digits}0`,
    "hex",
  ).toString("latin1");
}

/** How many pages the document declares. */
export function pdfPageCount(bytes: Buffer): number {
  // `/Type /Pages` carries the total; individual `/Page` objects do not.
  const match = /\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/.exec(
    bytes.toString("latin1"),
  );

  if (match) return Number(match[1]);

  // Some writers put /Count before /Type in the same dictionary.
  const reversed = /\/Count\s+(\d+)[\s\S]{0,200}?\/Type\s*\/Pages/.exec(
    bytes.toString("latin1"),
  );

  return reversed ? Number(reversed[1]) : 0;
}
