/**
 * CSV generation.
 *
 * Two problems this solves, both of which bite in practice:
 *
 * 1. **Formula injection.** Excel, LibreOffice and Google Sheets treat a cell
 *    beginning `=`, `+`, `-`, `@`, tab or carriage return as a formula. A
 *    customer whose name is stored as `=HYPERLINK("http://evil","click")` — or
 *    a booking note containing `=cmd|' /c calc'!A1` — becomes executable the
 *    moment someone opens the export. Escaping quotes alone does NOT prevent
 *    this; the leading character has to be neutralised.
 *
 * 2. **Delimiter and newline handling.** A note containing a comma, a quote or
 *    a line break must not break the row structure.
 */

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Neutralises a cell that a spreadsheet would otherwise evaluate.
 *
 * A leading apostrophe forces text interpretation. The original value stays
 * readable — nothing is stripped — so the export remains faithful to the data.
 */
function neutraliseFormula(value: string): string {
  if (value.length === 0) return value;

  const first = value[0]!;
  return FORMULA_PREFIXES.includes(first) ? `'${value}` : value;
}

/** Quotes and escapes a single field. */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text: string;

  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === "boolean") {
    text = value ? "Yes" : "No";
  } else {
    text = String(value);
  }

  text = neutraliseFormula(text);

  // Quote when the field contains a delimiter, quote, newline, or leading or
  // trailing whitespace that would otherwise be trimmed by a reader.
  const needsQuoting =
    /[",\n\r]/.test(text) || text !== text.trim();

  if (needsQuoting) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/** Largest export permitted in one request. */
export const MAX_EXPORT_ROWS = 10_000;

export interface CsvResult {
  content: string;
  rowCount: number;
  /** True when the result was cut short by MAX_EXPORT_ROWS. */
  truncated: boolean;
}

/**
 * Builds a CSV document.
 *
 * Truncation is reported rather than silent: an export that quietly stops at
 * 10,000 rows reads as "this is everything" when it is not.
 */
export function buildCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): CsvResult {
  const truncated = rows.length > MAX_EXPORT_ROWS;
  const included = truncated ? rows.slice(0, MAX_EXPORT_ROWS) : rows;

  const lines: string[] = [
    columns.map((column) => escapeCsvValue(column.header)).join(","),
  ];

  for (const row of included) {
    lines.push(columns.map((column) => escapeCsvValue(column.value(row))).join(","));
  }

  if (truncated) {
    // Stated in the file itself, so a spreadsheet opened later still carries
    // the warning.
    lines.push("");
    lines.push(
      escapeCsvValue(
        `Truncated: showing the first ${MAX_EXPORT_ROWS.toLocaleString()} of ${rows.length.toLocaleString()} matching rows. Narrow the filters to export the rest.`,
      ),
    );
  }

  return {
    // CRLF is what RFC 4180 specifies and what Excel expects.
    content: lines.join("\r\n"),
    rowCount: included.length,
    truncated,
  };
}

/** Timestamped filename, e.g. `bookings-2026-10-19.csv`. */
export function csvFilename(prefix: string, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  const safePrefix = prefix.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return `${safePrefix}-${stamp}.csv`;
}

/**
 * Wraps CSV content in a download response.
 *
 * The UTF-8 BOM makes Excel read non-ASCII characters correctly; without it,
 * accented passenger names arrive mangled.
 */
export function csvResponse(csv: CsvResult, filename: string): Response {
  return new Response(`﻿${csv.content}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Exports contain customer data; never let a proxy or the browser cache
      // them.
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
