/**
 * Money handling.
 *
 * Amounts are integers in the currency's minor unit (cents for USD). Floating
 * point is never used: 0.1 + 0.2 is not 0.3 in IEEE-754, and a cent of drift
 * per booking becomes a reconciliation problem at scale.
 *
 * Every amount travels with its currency. Two amounts in different currencies
 * are never added — `sumMinor` refuses the operation rather than producing a
 * number that silently means nothing.
 */

export interface Money {
  amountMinor: number;
  currency: string;
}

/** Currencies whose minor unit is not 1/100. */
const MINOR_UNIT_EXPONENTS: Readonly<Record<string, number>> = {
  BHD: 3,
  CLP: 0,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  OMR: 3,
  TND: 3,
  VND: 0,
};

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENTS[currency.toUpperCase()] ?? 2;
}

export class CurrencyMismatchError extends Error {
  constructor(currencies: readonly string[]) {
    super(
      `Cannot combine amounts in different currencies: ${currencies.join(", ")}. Convert through a defined exchange-rate policy first.`,
    );
    this.name = "CurrencyMismatchError";
  }
}

/**
 * Parses a user-entered decimal amount into minor units.
 *
 * Works on the string rather than via `parseFloat` so that "1029.97" becomes
 * exactly 102997 instead of 102996.99999999999.
 */
export function parseAmountToMinor(
  input: string,
  currency: string,
): number | null {
  const trimmed = input.trim().replace(/[\s,]/g, "");
  if (trimmed === "") return null;

  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) return null;

  const [, sign, whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return null;

  const exponent = minorUnitExponent(currency);

  // Reject more precision than the currency actually has, rather than rounding
  // away money the user typed.
  if (fraction.length > exponent) return null;

  const paddedFraction = fraction.padEnd(exponent, "0");
  const digits = `${whole || "0"}${paddedFraction}`;
  const value = Number(digits);

  if (!Number.isSafeInteger(value)) return null;

  return sign === "-" ? -value : value;
}

/** Converts minor units to a plain decimal string, e.g. 102997 → "1029.97". */
export function minorToDecimalString(
  amountMinor: number,
  currency: string,
): string {
  const exponent = minorUnitExponent(currency);
  if (exponent === 0) return String(amountMinor);

  const negative = amountMinor < 0;
  const digits = String(Math.abs(amountMinor)).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Formats minor units for display, e.g. 102997 USD → "$1,029.97". */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = "en-US",
): string {
  const exponent = minorUnitExponent(currency);

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(amountMinor / 10 ** exponent);
}

/**
 * Adds amounts that share a currency.
 *
 * Throws on a mixed-currency list rather than returning a meaningless total.
 */
export function sumMinor(amounts: readonly Money[]): Money | null {
  if (amounts.length === 0) return null;

  const currencies = new Set(amounts.map((a) => a.currency.toUpperCase()));
  if (currencies.size > 1) {
    throw new CurrencyMismatchError([...currencies]);
  }

  const [first] = amounts;
  // Guarded by the length check above.
  const currency = first!.currency.toUpperCase();

  return {
    amountMinor: amounts.reduce((total, a) => total + a.amountMinor, 0),
    currency,
  };
}
