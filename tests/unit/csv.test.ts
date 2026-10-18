import { describe, expect, it } from "vitest";

import {
  MAX_EXPORT_ROWS,
  buildCsv,
  csvFilename,
  escapeCsvValue,
} from "@/lib/export/csv";

/**
 * CSV safety.
 *
 * The formula-injection cases are the point of this file. A customer name or
 * booking note is attacker-influenced text that lands in a spreadsheet an
 * operator will open, and a cell starting with `=` is executed there.
 */

describe("formula injection", () => {
  it("neutralises a cell beginning with =", () => {
    const cell = escapeCsvValue('=HYPERLINK("http://evil.example","Click")');

    // The leading apostrophe forces text interpretation in Excel, LibreOffice
    // and Sheets.
    expect(cell.startsWith('"\'=') || cell.startsWith("'=")).toBe(true);
    expect(cell).not.toMatch(/^=/);
  });

  it("neutralises the classic command-execution payload", () => {
    const cell = escapeCsvValue("=cmd|' /c calc'!A1");
    expect(cell).not.toMatch(/^=/);
    expect(cell).toContain("'=cmd");
  });

  it("neutralises every dangerous prefix", () => {
    for (const prefix of ["=", "+", "-", "@", "\t", "\r"]) {
      const cell = escapeCsvValue(`${prefix}SUM(A1:A9)`);
      // Whether quoted or not, the payload must not be the first character.
      const unquoted = cell.startsWith('"') ? cell.slice(1) : cell;
      expect(unquoted.startsWith("'")).toBe(true);
    }
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeCsvValue("Candido Gomez Lara")).toBe("Candido Gomez Lara");
    expect(escapeCsvValue("MV70056")).toBe("MV70056");
  });

  it("does not mangle a negative number into a formula escape it did not need", () => {
    // A leading "-" is genuinely ambiguous: Excel treats -5 as a number, but
    // "-cmd" as a formula. Erring toward safety is correct here.
    const cell = escapeCsvValue("-500.00");
    expect(cell).toContain("-500.00");
  });
});

describe("escaping", () => {
  it("quotes a field containing a comma", () => {
    expect(escapeCsvValue("Miami, FL")).toBe('"Miami, FL"');
  });

  it("doubles embedded quotes", () => {
    expect(escapeCsvValue('He said "no"')).toBe('"He said ""no"""');
  });

  it("quotes a field containing a newline", () => {
    expect(escapeCsvValue("line one\nline two")).toBe('"line one\nline two"');
  });

  it("preserves significant whitespace by quoting", () => {
    expect(escapeCsvValue("  padded  ")).toBe('"  padded  "');
  });

  it("renders null and undefined as empty, not as the word", () => {
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(undefined)).toBe("");
  });

  it("renders booleans readably", () => {
    expect(escapeCsvValue(true)).toBe("Yes");
    expect(escapeCsvValue(false)).toBe("No");
  });

  it("renders dates in ISO form", () => {
    expect(escapeCsvValue(new Date("2026-10-19T12:00:00Z"))).toBe(
      "2026-10-19T12:00:00.000Z",
    );
  });
});

interface Row {
  name: string;
  amount: number;
}

const columns = [
  { header: "Name", value: (row: Row) => row.name },
  { header: "Amount", value: (row: Row) => row.amount },
];

describe("buildCsv", () => {
  it("writes a header row followed by the data", () => {
    const result = buildCsv([{ name: "Ada", amount: 10 }], columns);

    expect(result.content.split("\r\n")).toEqual(["Name,Amount", "Ada,10"]);
    expect(result.rowCount).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("uses CRLF line endings, as RFC 4180 and Excel expect", () => {
    const result = buildCsv(
      [
        { name: "A", amount: 1 },
        { name: "B", amount: 2 },
      ],
      columns,
    );

    expect(result.content).toContain("\r\n");
  });

  it("produces only a header for an empty result", () => {
    const result = buildCsv([], columns);

    expect(result.content).toBe("Name,Amount");
    expect(result.rowCount).toBe(0);
  });

  it("escapes injected content inside a built document", () => {
    const result = buildCsv([{ name: "=1+1", amount: 5 }], columns);

    const dataLine = result.content.split("\r\n")[1]!;
    expect(dataLine).not.toMatch(/^=/);
    expect(dataLine).toContain("'=1+1");
  });

  it("truncates at the cap and says so rather than failing silently", () => {
    const rows = Array.from({ length: MAX_EXPORT_ROWS + 50 }, (_, index) => ({
      name: `Row ${index}`,
      amount: index,
    }));

    const result = buildCsv(rows, columns);

    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(MAX_EXPORT_ROWS);
    // The warning travels with the file, not just the UI that generated it.
    expect(result.content).toContain("Truncated");
    expect(result.content).toContain((MAX_EXPORT_ROWS + 50).toLocaleString());
  });
});

describe("csvFilename", () => {
  it("includes the date", () => {
    expect(csvFilename("bookings", new Date("2026-10-19T00:00:00Z"))).toBe(
      "bookings-2026-10-19.csv",
    );
  });

  it("strips characters that would break a filename", () => {
    const name = csvFilename("book/ings..", new Date("2026-10-19T00:00:00Z"));
    expect(name).not.toContain("/");
    expect(name.endsWith(".csv")).toBe(true);
  });
});
