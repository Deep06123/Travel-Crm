"use server";

import { revalidatePath } from "next/cache";

import { AuditAction } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  resetBusinessSetting,
  saveBusinessSetting,
  SettingValidationError,
} from "@/server/services/business-settings-service";

const log = loggerFor("settings-actions");

export interface SettingActionState {
  error?: string;
  success?: string;
}

export async function saveBusinessSettingAction(
  _previous: SettingActionState,
  formData: FormData,
): Promise<SettingActionState> {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);

  const key = String(formData.get("key") ?? "").trim();
  const value = String(formData.get("value") ?? "");

  if (key === "") return { error: "Invalid request." };

  try {
    await saveBusinessSetting(key, value, user.id);
  } catch (error) {
    if (error instanceof SettingValidationError) return { error: error.message };

    log.error({ err: error, key }, "Failed to save business setting");
    return { error: "The setting could not be saved. Try again." };
  }

  revalidatePath("/admin/settings");
  return { success: "Saved." };
}

export async function resetBusinessSettingAction(
  _previous: SettingActionState,
  formData: FormData,
): Promise<SettingActionState> {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);

  const key = String(formData.get("key") ?? "").trim();
  if (key === "") return { error: "Invalid request." };

  try {
    await resetBusinessSetting(key, user.id);
  } catch (error) {
    log.error({ err: error, key }, "Failed to reset business setting");
    return { error: "The setting could not be reset. Try again." };
  }

  revalidatePath("/admin/settings");
  return { success: "Restored to the built-in default." };
}

// --- Audit log --------------------------------------------------------------

/**
 * Deletes a single audit entry.
 *
 * This is here because it was asked for, and it is worth being plain about
 * what it costs. The audit log is the application's evidence trail: it is what
 * answers "who authorised this refund" and "who changed the terms the customer
 * agreed to", months later, to someone who is not inclined to take our word
 * for it. The schema says rows are never updated or deleted, and every other
 * part of this codebase is written on that assumption.
 *
 * Three things narrow the blast radius:
 *
 *   - `auditLog.delete` is its own permission, held by SUPER_ADMIN alone under
 *     the default grants.
 *   - The deletion writes its own audit entry, carrying the deleted row's
 *     summary and actor. Removing one entry therefore leaves a visible scar
 *     rather than a silent hole — unless that entry is deleted too, which is
 *     the limit of what any in-system control can do.
 *   - Only one row at a time. There is deliberately no bulk delete and no
 *     date-range purge, because the difference between removing a mistake and
 *     clearing a trail is mostly a question of volume.
 *
 * For genuine retention trimming, a scheduled job against the database with a
 * documented policy is the right tool, not a button in the admin.
 */
export async function deleteAuditEntryAction(
  _previous: SettingActionState,
  formData: FormData,
): Promise<SettingActionState> {
  const user = await requirePermission(PERMISSIONS.AUDIT_LOG_DELETE);

  const id = String(formData.get("id") ?? "").trim();
  if (id === "") return { error: "Invalid request." };

  const entry = await prisma.auditLog.findUnique({
    where: { id },
    select: {
      summary: true,
      entityType: true,
      entityId: true,
      createdAt: true,
      adminUser: { select: { name: true } },
    },
  });

  if (!entry) return { error: "That entry no longer exists." };

  try {
    await prisma.auditLog.delete({ where: { id } });

    await recordAudit({
      action: AuditAction.DELETE,
      entityType: "AuditLog",
      entityId: id,
      adminUserId: user.id,
      summary: `Deleted an audit entry: "${entry.summary}"`,
      changes: {
        deletedEntry: {
          before: {
            summary: entry.summary,
            entityType: entry.entityType,
            entityId: entry.entityId,
            actor: entry.adminUser?.name ?? "Unknown",
            at: entry.createdAt.toISOString(),
          },
          after: null,
        },
      },
    });
  } catch (error) {
    log.error({ err: error, id }, "Failed to delete audit entry");
    return { error: "The entry could not be deleted." };
  }

  revalidatePath("/admin/audit-logs");
  return { success: "Entry deleted. The deletion is itself recorded." };
}
