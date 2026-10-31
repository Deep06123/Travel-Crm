import { describe, expect, it } from "vitest";

import { yesNo } from "@/features/bookings/schemas";

/**
 * The Yes/No selects on the booking forms.
 *
 * These were parsed with `z.coerce.boolean()`, which is `Boolean(value)` — and
 * the string "false" is truthy, so choosing "No" stored `true`. Every booking
 * created through either form therefore recorded split charges, gratuities and
 * insurance as included whatever the agent picked.
 *
 * A checkbox coerces correctly, because an unchecked box submits nothing at
 * all; only the fields rendered as a select were affected.
 */
describe("yesNo", () => {
  it("reads 'false' as false rather than as a non-empty string", () => {
    expect(yesNo.parse("false")).toBe(false);
  });

  it("reads 'true' as true", () => {
    expect(yesNo.parse("true")).toBe(true);
  });

  it("defaults to false when the field is absent", () => {
    expect(yesNo.parse(undefined)).toBe(false);
  });

  it("rejects anything that is not one of the two options", () => {
    expect(yesNo.safeParse("yes").success).toBe(false);
    expect(yesNo.safeParse("").success).toBe(false);
    expect(yesNo.safeParse("1").success).toBe(false);
  });
});
