import { CARD_BRAND_RULES } from "@/features/bookings/card-validation";
import type { CardType } from "@/generated/prisma/client";

/**
 * How a stored card is written wherever a customer reads one back.
 *
 * One definition, because the same card is now printed in three places — the
 * authorization email, the e-ticket, and the page the customer signs from — and
 * a customer comparing two of them against the same booking must not find two
 * different spellings of the same card. The wording here is the authorization
 * email's, which shipped first and is the one customers have already seen.
 *
 * Nothing is redacted here. `schema.prisma` keeps no PAN and no CVV — the
 * number is typed into the agent's form, used to key the terminal, and
 * discarded in the browser without ever being submitted — so `cardLast4` is the
 * whole of the card number that exists anywhere, and the stars are drawn rather
 * than covering something up.
 */

/** The brand's customer-facing name, or `null` when the booking records none. */
export function cardBrandLabel(type: CardType | null): string | null {
  if (!type) return null;
  return CARD_BRAND_RULES.find((rule) => rule.type === type)?.label ?? "Card";
}

/**
 * `Visa (****1111)`, or as much of it as the booking knows.
 *
 * Returns `null` rather than a placeholder when there is no card on the booking
 * at all: a payment line naming no card is misleading, so callers omit the row
 * instead of printing an empty one.
 */
export function maskedCard(
  cardType: CardType | null,
  cardLast4: string | null,
): string | null {
  const brand = cardBrandLabel(cardType);
  const last4 = cardLast4?.trim();

  if (!brand && !last4) return null;
  if (!last4) return brand;

  return brand ? `${brand} (****${last4})` : `****${last4}`;
}
