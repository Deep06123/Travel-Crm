import "server-only";

import { AuditAction } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";
import {
  defaultPolicyLines,
  policySectionHeading,
  type PolicyDocument,
  type PolicyOverrides,
  type PolicySection,
} from "@/lib/mail/policies";

const log = loggerFor("email-policy-service");

/**
 * The policy wording printed at the foot of customer emails, as operators
 * configure it.
 *
 * Stored in `BusinessSetting` rather than a table of its own: there are
 * exactly three rows, they are keyed by a constant, and they are read on every
 * send. A row exists only once someone has edited that section — absence means
 * "use what is in the code", which is why there is no seed for these.
 *
 * Every write is audited. These sentences are the terms a customer is held to
 * over a change fee or a refund months later, so who changed them and when is
 * part of the answer when that argument happens.
 */

/** Keyed so the stored row name reads for itself in the settings table. */
const SETTING_KEYS: Record<PolicySection, string> = {
  bookingPolicy: "email_policy_booking_policy",
  changeRules: "email_policy_change_rules",
  travelRules: "email_policy_travel_rules",
};

/** The three keys, for the settings page to exclude from its generic table. */
export const POLICY_SETTING_KEYS: readonly string[] =
  Object.values(SETTING_KEYS);

export const POLICY_SECTIONS: readonly PolicySection[] = [
  "bookingPolicy",
  "changeRules",
  "travelRules",
];

/** Guards against a key the enum no longer contains, and against a long essay. */
export const MAX_POLICY_LINES = 30;
export const MAX_POLICY_LINE_LENGTH = 600;

function isPolicySection(value: string): value is PolicySection {
  return (POLICY_SECTIONS as readonly string[]).includes(value);
}

/**
 * Decodes a stored JSON column into lines.
 *
 * The column is `Json`, so anything could be in it — a hand-edited row, a
 * value from an older shape. Non-strings are dropped rather than coerced:
 * `String(null)` in a customer's terms and conditions is worse than the line
 * being missing.
 */
function toLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Every section an operator has rewritten.
 *
 * Returns `{}` when nothing is overridden, which `renderPolicySections` reads
 * as "use the built-in wording for all three".
 */
export async function loadPolicyOverrides(): Promise<PolicyOverrides> {
  let rows: { key: string; value: unknown }[];

  try {
    rows = await prisma.businessSetting.findMany({
      where: { key: { in: [...POLICY_SETTING_KEYS] } },
      select: { key: true, value: true },
    });
  } catch (error) {
    // A send must not fail because the settings lookup did. Falling back to
    // the built-in terms prints wording that is at least correct and current
    // in the repository, which is a better outcome than no email at all.
    log.error({ err: error }, "Could not load policy overrides; using defaults");
    return {};
  }

  const overrides: PolicyOverrides = {};

  for (const [section, key] of Object.entries(SETTING_KEYS)) {
    const row = rows.find((candidate) => candidate.key === key);
    // No row means "never edited" — unset, so the default applies. A row
    // holding an empty list means "deliberately emptied", which is kept as an
    // empty override so the section is dropped from the email.
    if (!row) continue;

    overrides[section as PolicySection] = toLines(row.value);
  }

  return overrides;
}

export interface PolicySectionView {
  section: PolicySection;
  /** As the customer sees it. The flight wording; cruise bookings say "Cruise". */
  heading: string;
  /** What is printed today: the override if there is one, else the default. */
  lines: readonly string[];
  /** The built-in wording, so the page can offer to restore it. */
  defaultLines: readonly string[];
  /** True once a row exists, including when it was emptied on purpose. */
  isCustom: boolean;
}

/**
 * The three sections as the settings page shows them.
 *
 * Rendered against the authorization document's tense, because that is the
 * message these lines were written for and the one an operator is most likely
 * picturing. The page says plainly that an edit applies to both messages.
 */
export async function listPolicySections(
  document: PolicyDocument = "authorization",
): Promise<PolicySectionView[]> {
  const overrides = await loadPolicyOverrides();

  return POLICY_SECTIONS.map((section) => {
    const defaultLines = defaultPolicyLines(section, document);
    const override = overrides[section];

    return {
      section,
      heading: policySectionHeading(section, false),
      lines: override ?? defaultLines,
      defaultLines,
      isCustom: override !== undefined,
    };
  });
}

export class PolicyValidationError extends Error {}

/**
 * Replaces one section's wording.
 *
 * Passing no lines restores the built-in default by deleting the row, rather
 * than storing an empty list — the two are different states and the settings
 * page exposes both: "Restore default" deletes, "Save" with an empty box
 * stores `[]` and drops the section from the email.
 */
export async function savePolicySection(
  section: string,
  lines: readonly string[],
  actorId: string,
): Promise<void> {
  if (!isPolicySection(section)) {
    throw new PolicyValidationError(`Unknown policy section: ${section}`);
  }

  if (lines.length > MAX_POLICY_LINES) {
    throw new PolicyValidationError(
      `A section may hold at most ${MAX_POLICY_LINES} lines.`,
    );
  }

  const tooLong = lines.find((line) => line.length > MAX_POLICY_LINE_LENGTH);
  if (tooLong) {
    throw new PolicyValidationError(
      `Each line may be at most ${MAX_POLICY_LINE_LENGTH} characters.`,
    );
  }

  const key = SETTING_KEYS[section];
  const previous = await prisma.businessSetting.findUnique({
    where: { key },
    select: { value: true },
  });

  await prisma.businessSetting.upsert({
    where: { key },
    create: {
      key,
      value: [...lines],
      description: `Customer email wording for "${policySectionHeading(section, false)}".`,
    },
    update: { value: [...lines] },
  });

  await recordAudit({
    action: AuditAction.UPDATE,
    entityType: "BusinessSetting",
    entityId: key,
    adminUserId: actorId,
    summary: `Rewrote the "${policySectionHeading(section, false)}" wording in customer emails`,
    changes: {
      lines: {
        before: previous ? toLines(previous.value) : "built-in default",
        after: [...lines],
      },
    },
  });
}

/** Deletes the override so the built-in wording applies again. */
export async function restorePolicySection(
  section: string,
  actorId: string,
): Promise<void> {
  if (!isPolicySection(section)) {
    throw new PolicyValidationError(`Unknown policy section: ${section}`);
  }

  const key = SETTING_KEYS[section];
  const deleted = await prisma.businessSetting.deleteMany({ where: { key } });

  // Nothing was overridden, so nothing changed. Auditing a no-op would put an
  // entry in the trail for a button press that had no effect.
  if (deleted.count === 0) return;

  await recordAudit({
    action: AuditAction.UPDATE,
    entityType: "BusinessSetting",
    entityId: key,
    adminUserId: actorId,
    summary: `Restored the built-in "${policySectionHeading(section, false)}" wording`,
  });
}
