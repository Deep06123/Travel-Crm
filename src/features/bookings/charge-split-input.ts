import { formatMoney } from "@/lib/financial/money";

import { chargeSplitSchema, moneyFieldToMinor } from "./schemas";

/**
 * Reading split-charge rows off a form, and checking they add up.
 *
 * Lifted out of `actions.ts` so the booking editor can apply the same rule
 * the create form does. Two places that divide a total must agree on what a
 * valid division is, and the way they stop agreeing is by each keeping their
 * own copy of the arithmetic.
 *
 * Deliberately not in `actions.ts` itself: that file is `"use server"`, where
 * every export has to be an async server action, so a plain helper cannot be
 * shared from it.
 */

/** Field errors keyed the way the form names its controls. */
export function collectFieldErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
  prefix = "",
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of issues) {
    const field = `${prefix}${issue.path.join(".")}`;
    if (!fieldErrors[field]) fieldErrors[field] = issue.message;
  }

  return fieldErrors;
}

/**
 * Extracts repeated form groups such as `passengers.0.firstName`.
 *
 * Indices are collected from the submitted keys rather than assumed
 * contiguous, so removing the middle row of a repeater does not silently drop
 * every row after it.
 */
export function extractGroup(
  formData: FormData,
  prefix: string,
): { index: number; data: Record<string, string> }[] {
  const byIndex = new Map<number, Record<string, string>>();

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (!key.startsWith(`${prefix}.`)) continue;

    const [, rawIndex, ...rest] = key.split(".");
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || rest.length === 0) continue;

    const entry = byIndex.get(index) ?? {};
    entry[rest.join(".")] = value;
    byIndex.set(index, entry);
  }

  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, data]) => ({ index, data }));
}

/** A split, with its amount already converted against the booking currency. */
export interface ChargeSplitDraft {
  title: string;
  amountMinor: number;
}

/**
 * Reads the split-charge rows, and checks they account for the whole total.
 *
 * Splits that do not add up are the mistake this is here to catch: a total
 * divided across two cards with one figure mistyped looks right on the form
 * and wrong in the ledger a week later. The division is therefore checked
 * where it is entered, in minor units so a cent cannot hide in a rounding.
 *
 * Returns the splits, and writes any problem into `fieldErrors` for the
 * caller to return with the rest.
 */
export function parseChargeSplits(
  formData: FormData,
  options: {
    currency: string;
    splitCharges: boolean;
    totalMinor: number;
    hasTotal: boolean;
  },
  fieldErrors: Record<string, string>,
): ChargeSplitDraft[] {
  // Not split: whatever the rows hold is ignored rather than stored against a
  // booking that does not claim to be split.
  if (!options.splitCharges) return [];

  const splits: ChargeSplitDraft[] = [];

  for (const group of extractGroup(formData, "splits")) {
    const hasContent = Object.values(group.data).some(
      (value) => value.trim() !== "",
    );
    if (!hasContent) continue;

    const result = chargeSplitSchema.safeParse(group.data);

    if (!result.success) {
      Object.assign(
        fieldErrors,
        collectFieldErrors(result.error.issues, `splits.${group.index}.`),
      );
      continue;
    }

    const amount = moneyFieldToMinor(
      result.data.amount,
      options.currency,
      `splits.${group.index}.amount`,
    );

    if (!amount.ok) {
      fieldErrors[amount.field] = amount.message;
      continue;
    }

    if (amount.minor <= 0) {
      fieldErrors[`splits.${group.index}.amount`] =
        "A split must be more than nothing.";
      continue;
    }

    splits.push({ title: result.data.title, amountMinor: amount.minor });
  }

  // A later check would be comparing a sum that is already known to be wrong.
  if (Object.keys(fieldErrors).some((key) => key.startsWith("splits."))) {
    return splits;
  }

  if (splits.length < 2) {
    fieldErrors["splits"] =
      "A split total needs at least two charges. Set split charges to No if there is only one.";
    return splits;
  }

  if (!options.hasTotal) {
    fieldErrors["total"] = "Enter the total fare before splitting it.";
    return splits;
  }

  const summed = splits.reduce((sum, split) => sum + split.amountMinor, 0);

  if (summed !== options.totalMinor) {
    fieldErrors["splits"] =
      `The splits add up to ${formatMoney(summed, options.currency)}, but the total fare is ${formatMoney(options.totalMinor, options.currency)}.`;
  }

  return splits;
}
