import { describe, expect, it } from "vitest";

import {
  CurrencyMismatchError,
  formatMoney,
  minorToDecimalString,
  minorUnitExponent,
  parseAmountToMinor,
  sumMinor,
} from "@/lib/financial/money";

describe("parseAmountToMinor", () => {
  it("parses a decimal amount without floating-point drift", () => {
    // parseFloat("1029.97") * 100 is 102996.99999999999.
    expect(parseAmountToMinor("1029.97", "USD")).toBe(102_997);
    expect(parseAmountToMinor("0.1", "USD")).toBe(10);
    expect(parseAmountToMinor("0.29", "USD")).toBe(29);
    expect(parseAmountToMinor("115.76", "USD")).toBe(11_576);
  });

  it("accepts whole numbers and bare fractions", () => {
    expect(parseAmountToMinor("75", "USD")).toBe(7_500);
    expect(parseAmountToMinor(".5", "USD")).toBe(50);
    expect(parseAmountToMinor("0", "USD")).toBe(0);
  });

  it("strips thousands separators and surrounding space", () => {
    expect(parseAmountToMinor(" 1,029.97 ", "USD")).toBe(102_997);
  });

  it("handles negative amounts", () => {
    expect(parseAmountToMinor("-50.25", "USD")).toBe(-5_025);
  });

  it("honours currencies whose minor unit is not 1/100", () => {
    expect(parseAmountToMinor("1200", "JPY")).toBe(1_200);
    expect(parseAmountToMinor("1.234", "KWD")).toBe(1_234);
  });

  it("rejects more precision than the currency has, rather than rounding", () => {
    expect(parseAmountToMinor("10.999", "USD")).toBeNull();
    expect(parseAmountToMinor("12.5", "JPY")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(parseAmountToMinor("", "USD")).toBeNull();
    expect(parseAmountToMinor("abc", "USD")).toBeNull();
    expect(parseAmountToMinor("1.2.3", "USD")).toBeNull();
    expect(parseAmountToMinor("$10", "USD")).toBeNull();
  });
});

describe("minorToDecimalString", () => {
  it("renders minor units as an exact decimal", () => {
    expect(minorToDecimalString(102_997, "USD")).toBe("1029.97");
    expect(minorToDecimalString(5, "USD")).toBe("0.05");
    expect(minorToDecimalString(0, "USD")).toBe("0.00");
    expect(minorToDecimalString(-5_025, "USD")).toBe("-50.25");
  });

  it("omits the separator for zero-decimal currencies", () => {
    expect(minorToDecimalString(1_200, "JPY")).toBe("1200");
  });

  it("round-trips with parseAmountToMinor", () => {
    for (const input of ["0.01", "1029.97", "99999.99"]) {
      const minor = parseAmountToMinor(input, "USD");
      expect(minor).not.toBeNull();
      expect(minorToDecimalString(minor!, "USD")).toBe(input);
    }
  });
});

describe("formatMoney", () => {
  it("formats with the currency symbol and correct precision", () => {
    expect(formatMoney(102_997, "USD")).toBe("$1,029.97");
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });

  it("uses no decimal places for zero-decimal currencies", () => {
    expect(formatMoney(1_200, "JPY")).toBe("¥1,200");
  });
});

describe("minorUnitExponent", () => {
  it("defaults to 2 and is case-insensitive", () => {
    expect(minorUnitExponent("USD")).toBe(2);
    expect(minorUnitExponent("gbp")).toBe(2);
    expect(minorUnitExponent("jpy")).toBe(0);
    expect(minorUnitExponent("KWD")).toBe(3);
  });
});

describe("sumMinor", () => {
  it("adds amounts in the same currency", () => {
    expect(
      sumMinor([
        { amountMinor: 102_997, currency: "USD" },
        { amountMinor: 7_500, currency: "USD" },
      ]),
    ).toEqual({ amountMinor: 110_497, currency: "USD" });
  });

  it("returns null for an empty list", () => {
    expect(sumMinor([])).toBeNull();
  });

  it("refuses to add across currencies instead of returning a wrong total", () => {
    expect(() =>
      sumMinor([
        { amountMinor: 10_000, currency: "USD" },
        { amountMinor: 10_000, currency: "EUR" },
      ]),
    ).toThrow(CurrencyMismatchError);
  });
});
