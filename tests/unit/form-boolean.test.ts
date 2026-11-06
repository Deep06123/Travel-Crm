import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * How a form's booleans are read.
 *
 * This exists because of a bug worth not reintroducing: the schemas used
 * `z.coerce.boolean()`, which is `Boolean(value)` — and `Boolean("false")` is
 * `true`. A select posting "false" therefore saved as active, so Active → No
 * silently did nothing on every supplier, MCO supplier, TFN and booking type
 * form in the admin.
 *
 * Mirrors `formBoolean` in `features/admin/reference-actions`, which cannot be
 * imported here: that module is `"use server"`, so every export has to be an
 * async action and a plain helper is not reachable from a test.
 */
const formBoolean = (fallback: boolean) =>
  z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") return fallback;
      if (typeof value === "boolean") return value;
      return value === "true" || value === "on" || value === "1";
    });

describe("reading a boolean out of a form", () => {
  const defaultTrue = formBoolean(true);
  const defaultFalse = formBoolean(false);

  it('reads "false" as false, which coercion got wrong', () => {
    expect(defaultTrue.parse("false")).toBe(false);
  });

  it('reads the values a form actually posts for true', () => {
    // A select posts "true"; an unlabelled checkbox posts "on".
    expect(defaultFalse.parse("true")).toBe(true);
    expect(defaultFalse.parse("on")).toBe(true);
    expect(defaultFalse.parse("1")).toBe(true);
  });

  it("falls back when the field is absent", () => {
    // An unticked checkbox posts nothing at all, which is the default's job.
    expect(defaultTrue.parse(undefined)).toBe(true);
    expect(defaultFalse.parse(undefined)).toBe(false);
    expect(defaultTrue.parse("")).toBe(true);
  });

  it("treats anything else as false rather than guessing", () => {
    expect(defaultTrue.parse("no")).toBe(false);
    expect(defaultTrue.parse("0")).toBe(false);
  });
});
