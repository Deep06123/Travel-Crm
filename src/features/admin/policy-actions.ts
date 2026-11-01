"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/dal";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  MAX_POLICY_LINES,
  PolicyValidationError,
  restorePolicySection,
  savePolicySection,
} from "@/server/services/email-policy-service";

const log = loggerFor("policy-actions");

export interface PolicyFormState {
  error?: string;
  success?: string;
}

/**
 * One bullet per line.
 *
 * A textarea rather than a repeating row of inputs because these are
 * paragraphs of prose that operators paste in from a document, and reordering
 * them should be a matter of moving a line. Blank lines are dropped rather
 * than becoming empty bullets.
 */
function toLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export async function savePolicySectionAction(
  _previous: PolicyFormState,
  formData: FormData,
): Promise<PolicyFormState> {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);

  const section = String(formData.get("section") ?? "");
  const restore = formData.get("intent") === "restore";

  try {
    if (restore) {
      await restorePolicySection(section, user.id);
    } else {
      const lines = toLines(String(formData.get("lines") ?? ""));

      if (lines.length > MAX_POLICY_LINES) {
        return {
          error: `That is ${lines.length} lines; the limit is ${MAX_POLICY_LINES}.`,
        };
      }

      await savePolicySection(section, lines, user.id);
    }
  } catch (error) {
    if (error instanceof PolicyValidationError) {
      return { error: error.message };
    }

    log.error({ err: error, section }, "Failed to save policy section");
    return { error: "The wording could not be saved. Please try again." };
  }

  // Both previews read the stored wording on render, so they would otherwise
  // keep showing the old terms from the cache.
  revalidatePath("/admin/settings");
  revalidatePath("/admin/bookings", "layout");

  return {
    success: restore
      ? "Restored the built-in wording."
      : "Saved. New emails will use this wording.",
  };
}
