import "server-only";

import { AuditAction } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";

/**
 * Editing the key-value business settings from the settings screen.
 *
 * The column is `Json`, so without a schema this would be a textarea that
 * accepts anything and a reader somewhere that falls over on a Tuesday. Each
 * editable key is therefore declared here with the shape it must hold, and a
 * key not in this table is shown but not editable — a row someone added by
 * hand is not something a form should be guessing the type of.
 *
 * Deleting a setting is "restore the default", not "remove the feature".
 * Every reader is written to fall back to a constant when the row is absent
 * (see `approvalThresholdMinor` in `refund-service`), and the seed recreates
 * the standard rows on the next deploy without overwriting an edited value.
 */

export type SettingKind = "text" | "integer" | "list";

interface SettingSpec {
  kind: SettingKind;
  label: string;
  hint: string;
  /** Rejects a value the readers could not cope with. */
  validate?: (value: unknown) => string | null;
}

const UPPERCASE_CODE = /^[A-Z]{3}$/;

export const EDITABLE_SETTINGS: Record<string, SettingSpec> = {
  supported_currencies: {
    kind: "list",
    label: "Supported currencies",
    hint: "Three-letter codes, comma separated. These are what a booking may be priced in.",
    validate: (value) =>
      Array.isArray(value) &&
      value.every((code) => typeof code === "string" && UPPERCASE_CODE.test(code))
        ? null
        : "Each currency must be a three-letter code, e.g. USD.",
  },
  default_currency: {
    kind: "text",
    label: "Default currency",
    hint: "Pre-selected on a new booking. Must be one of the supported currencies.",
    validate: (value) =>
      typeof value === "string" && UPPERCASE_CODE.test(value.toUpperCase())
        ? null
        : "Enter a three-letter currency code, e.g. USD.",
  },
  business_timezone: {
    kind: "text",
    label: "Business timezone",
    hint: "IANA name, e.g. Asia/Kolkata. Reports bucket dates by this.",
    validate: (value) => {
      if (typeof value !== "string" || value.trim() === "") {
        return "Enter a timezone name.";
      }

      // Asked of the runtime rather than matched against a list: a typo here
      // silently moves every report's day boundary.
      try {
        new Intl.DateTimeFormat("en-GB", { timeZone: value });
        return null;
      } catch {
        return `"${value}" is not a timezone this server recognises.`;
      }
    },
  },
  refund_approval_threshold_minor: {
    kind: "integer",
    label: "Refund approval threshold",
    hint: "In minor units: 50000 means $500.00. Refunds at or above this need a super administrator.",
    validate: (value) =>
      typeof value === "number" && value >= 0
        ? null
        : "Enter a whole number of minor units, e.g. 50000 for $500.00.",
  },
  document_max_bytes: {
    kind: "integer",
    label: "Document max bytes",
    hint: "Largest accepted upload, in bytes. 15728640 is 15 MB.",
    validate: (value) =>
      typeof value === "number" && value > 0
        ? null
        : "Enter a size in bytes, greater than zero.",
  },
  document_allowed_content_types: {
    kind: "list",
    label: "Document allowed content types",
    hint: "MIME types, comma separated, e.g. application/pdf, image/png.",
    validate: (value) =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((type) => typeof type === "string" && type.includes("/"))
        ? null
        : "Enter at least one MIME type, e.g. application/pdf.",
  },
};

export function isEditableSetting(key: string): boolean {
  return key in EDITABLE_SETTINGS;
}

export class SettingValidationError extends Error {}

/**
 * Turns what the form posted into the JSON the column should hold.
 *
 * A list arrives as one string because a repeating field for five currency
 * codes is worse to use than a comma-separated box.
 */
function parseValue(key: string, raw: string): unknown {
  const spec = EDITABLE_SETTINGS[key];
  if (!spec) throw new SettingValidationError("That setting cannot be edited here.");

  switch (spec.kind) {
    case "integer": {
      const trimmed = raw.trim();
      const parsed = Number(trimmed);

      if (trimmed === "" || !Number.isInteger(parsed)) {
        throw new SettingValidationError("Enter a whole number.");
      }

      return parsed;
    }

    case "list":
      return raw
        .split(/[,\n]/)
        .map((part) => part.trim())
        .filter((part) => part !== "")
        // Currency codes are stored uppercase and MIME types lowercase, and
        // both are compared exactly somewhere. Normalising on the way in
        // beats every reader having to be defensive.
        .map((part) => (UPPERCASE_CODE.test(part.toUpperCase()) ? part.toUpperCase() : part.toLowerCase()));

    case "text":
      return UPPERCASE_CODE.test(raw.trim().toUpperCase())
        ? raw.trim().toUpperCase()
        : raw.trim();
  }
}

/** The stored value rendered for a form field. */
export function toInputValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

export async function saveBusinessSetting(
  key: string,
  raw: string,
  actorId: string,
): Promise<void> {
  const spec = EDITABLE_SETTINGS[key];
  if (!spec) throw new SettingValidationError("That setting cannot be edited here.");

  const value = parseValue(key, raw);

  const problem = spec.validate?.(value);
  if (problem) throw new SettingValidationError(problem);

  const existing = await prisma.businessSetting.findUnique({
    where: { key },
    select: { value: true },
  });

  await prisma.businessSetting.upsert({
    where: { key },
    create: { key, value: value as never, description: spec.hint },
    update: { value: value as never },
  });

  await recordAudit({
    action: AuditAction.UPDATE,
    entityType: "BusinessSetting",
    entityId: key,
    adminUserId: actorId,
    summary: `Changed the ${spec.label.toLowerCase()} setting`,
    changes: {
      value: { before: existing?.value ?? "built-in default", after: value },
    },
  });
}

/**
 * Deletes the row so the built-in default applies again.
 *
 * Not a destructive operation in the usual sense: readers fall back to a
 * constant, and the seed restores the row on the next deploy. It is how an
 * operator undoes an edit without having to remember what the value was.
 */
export async function resetBusinessSetting(
  key: string,
  actorId: string,
): Promise<void> {
  const existing = await prisma.businessSetting.findUnique({
    where: { key },
    select: { value: true },
  });

  // Nothing stored, so nothing to undo. Auditing a no-op would put an entry in
  // the trail for a button press that changed nothing.
  if (!existing) return;

  await prisma.businessSetting.delete({ where: { key } });

  await recordAudit({
    action: AuditAction.DELETE,
    entityType: "BusinessSetting",
    entityId: key,
    adminUserId: actorId,
    summary: `Reset the ${key} setting to its built-in default`,
    changes: { value: { before: existing.value, after: "built-in default" } },
  });
}
