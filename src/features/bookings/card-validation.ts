import { CardType } from "@/generated/prisma/enums";

/**
 * Card validation for the billing panel.
 *
 * The full card number and the CVV are never submitted (see
 * `billing-information.tsx`), so everything that needs the number itself —
 * the Luhn check, the brand check, the CVV length — can only be enforced in
 * the browser, before the form is allowed to submit. What survives the
 * submission is the last four digits, the brand and the expiry, and those are
 * re-checked on the server in `billingInformationFields`.
 *
 * That split is the honest one: the server cannot verify a number it is not
 * allowed to receive. What it *can* do, and does, is refuse to create a
 * booking that arrives without card details at all.
 *
 * None of this authorizes anything. A number can be well-formed and still be
 * declined by the terminal; that outcome is recorded separately as the
 * booking's charge outcome.
 */

export interface CardBrandRule {
  type: CardType;
  label: string;
  /** Issuer identification number prefixes. */
  pattern: RegExp;
  /** Accepted lengths of the full number, digits only. */
  lengths: readonly number[];
  /** Accepted lengths of the security code. */
  cvvLengths: readonly number[];
}

/**
 * Ordered: the first matching prefix wins, so the narrower ranges (JCB,
 * Diners) are tested before the broad ones they would otherwise be swallowed
 * by. `OTHER` is not in the table — it is the escape hatch for a card this
 * list does not know, and is checked against generic limits instead.
 */
export const CARD_BRAND_RULES: readonly CardBrandRule[] = [
  {
    type: CardType.AMERICAN_EXPRESS,
    label: "American Express",
    pattern: /^3[47]/,
    lengths: [15],
    cvvLengths: [4],
  },
  {
    type: CardType.JCB,
    label: "JCB",
    pattern: /^(352[89]|35[3-8]\d)/,
    lengths: [16, 17, 18, 19],
    cvvLengths: [3],
  },
  {
    type: CardType.DINERS_CLUB,
    label: "Diners Club",
    pattern: /^3(0[0-5]|095|6|8|9)/,
    lengths: [14, 16, 19],
    cvvLengths: [3],
  },
  {
    type: CardType.VISA,
    label: "Visa",
    pattern: /^4/,
    lengths: [13, 16, 19],
    cvvLengths: [3],
  },
  {
    type: CardType.MASTERCARD,
    label: "Mastercard",
    pattern: /^(5[1-5]|2(22[1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/,
    lengths: [16],
    cvvLengths: [3],
  },
  {
    type: CardType.DISCOVER,
    label: "Discover",
    pattern: /^(6011|65|64[4-9]|622(12[6-9]|1[3-9]\d|[2-8]\d\d|9[01]\d|92[0-5]))/,
    lengths: [16, 19],
    cvvLengths: [3],
  },
];

/** Lengths accepted when the brand is unrecognised, per ISO/IEC 7812. */
const GENERIC_LENGTHS = [12, 13, 14, 15, 16, 17, 18, 19] as const;
const GENERIC_CVV_LENGTHS = [3, 4] as const;

/** Digits only, so spacing and dashes typed off a card do not break anything. */
export function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * The mod-10 check digit every payment card carries.
 *
 * Catches the single-digit slips and adjacent transpositions that make up
 * most mis-keyings — which is the whole point of doing it here, while the
 * customer is still on the line to read the number again.
 */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;

  let sum = 0;
  let double = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48;

    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }

    sum += value;
    double = !double;
  }

  return sum % 10 === 0;
}

/** The brand a number belongs to, or `undefined` if no prefix matches. */
export function detectCardBrand(digits: string): CardBrandRule | undefined {
  return CARD_BRAND_RULES.find((rule) => rule.pattern.test(digits));
}

/** CVV lengths to accept for a chosen brand. */
export function cvvLengthsFor(
  type: CardType | "" | undefined,
): readonly number[] {
  const rule = CARD_BRAND_RULES.find((entry) => entry.type === type);
  return rule?.cvvLengths ?? GENERIC_CVV_LENGTHS;
}

/** MMYY, with a month that exists. */
export function expiryIsWellFormed(value: string): boolean {
  return /^(0[1-9]|1[0-2])\d{2}$/.test(value.trim());
}

/**
 * Whether an MMYY expiry is in the past.
 *
 * A card is good through the last day of its expiry month, so the comparison
 * is month-to-month and the current month is still valid. The two-digit year
 * is read as 20YY: cards are not issued with a 1900s expiry and will not be
 * before this code is gone.
 */
export function expiryHasPassed(value: string, now: Date = new Date()): boolean {
  const text = value.trim();
  if (!expiryIsWellFormed(text)) return false;

  const month = Number(text.slice(0, 2));
  const year = 2000 + Number(text.slice(2));

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  return year < currentYear || (year === currentYear && month < currentMonth);
}

export interface CardEntry {
  cardHolderName: string;
  cardType: CardType | "";
  cardNumber: string;
  cardExpiry: string;
  cvv: string;
}

/** Field keys this module can report against — the ids used in the form. */
export type CardField = keyof CardEntry;

export type CardErrors = Partial<Record<CardField, string>>;

/**
 * Validates everything the agent typed into the billing panel.
 *
 * Returns one message per bad field, keyed by the field's id so the form can
 * render it beside the control and the form guide can jump to it. An empty
 * object means the card may be submitted.
 */
export function validateCardEntry(
  entry: CardEntry,
  now: Date = new Date(),
): CardErrors {
  const errors: CardErrors = {};

  const holder = entry.cardHolderName.trim();
  if (holder === "") {
    errors.cardHolderName = "Enter the card holder name.";
  } else if (holder.length < 2) {
    errors.cardHolderName = "Enter the name as printed on the card.";
  } else if (holder.length > 200) {
    errors.cardHolderName = "That name is too long.";
  }

  if (entry.cardType === "") {
    errors.cardType = "Select the card type.";
  }

  // --- The number ---------------------------------------------------------

  const raw = entry.cardNumber.trim();
  const digits = digitsOf(raw);
  const brand = detectCardBrand(digits);

  if (raw === "") {
    errors.cardNumber = "Enter the card number.";
  } else if (/[^\d\s-]/.test(raw)) {
    errors.cardNumber = "A card number is digits only.";
  } else if (digits.length < 12 || digits.length > 19) {
    errors.cardNumber = "A card number is 12 to 19 digits.";
  } else if (!luhnValid(digits)) {
    // Deliberately worded as a mis-key rather than a verdict on the card:
    // this check cannot tell a wrong number from a dead one.
    errors.cardNumber = "That number is not valid — check it and re-enter it.";
  } else {
    const lengths = brand?.lengths ?? GENERIC_LENGTHS;

    if (!lengths.includes(digits.length)) {
      errors.cardNumber = brand
        ? `A ${brand.label} number is ${lengths.join(" or ")} digits.`
        : "That is not a card number length.";
    } else if (
      brand &&
      entry.cardType !== "" &&
      entry.cardType !== CardType.OTHER &&
      entry.cardType !== brand.type
    ) {
      // Reported against the select, not the number: the number passed every
      // check it has, and the selection is the likelier mistake.
      errors.cardType = `That number is a ${brand.label} card.`;
    }
  }

  // --- Expiry -------------------------------------------------------------

  const expiry = entry.cardExpiry.trim();
  if (expiry === "") {
    errors.cardExpiry = "Enter the expiry date.";
  } else if (!expiryIsWellFormed(expiry)) {
    errors.cardExpiry = "Enter the expiry as MMYY, e.g. 0428.";
  } else if (expiryHasPassed(expiry, now)) {
    errors.cardExpiry = "That card has expired.";
  }

  // --- CVV ----------------------------------------------------------------

  // Taken from the number's own brand when there is one, so an Amex typed
  // against a mis-set card type is still asked for four digits.
  const cvvLengths = brand?.cvvLengths ?? cvvLengthsFor(entry.cardType);
  const cvv = entry.cvv.trim();

  if (cvv === "") {
    errors.cvv = "Enter the CVV.";
  } else if (!/^\d+$/.test(cvv)) {
    errors.cvv = "The CVV is digits only.";
  } else if (!cvvLengths.includes(cvv.length)) {
    errors.cvv = `The CVV is ${cvvLengths.join(" or ")} digits.`;
  }

  return errors;
}
