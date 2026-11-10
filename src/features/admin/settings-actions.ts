"use server";

import { revalidatePath } from "next/cache";

import { AuditAction } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";
import { MAX_PAGE_SIZE } from "@/lib/pagination";
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
 *   - A selection is one page of the table at most — see
 *     `deleteAuditEntriesAction` below, which is this function over a list and
 *     subject to the same two rules.
 *
 * For genuine retention trimming, a scheduled job against the database with a
 * documented policy is still the right tool, not a button in the admin.
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

/**
 * Deletes a selection of audit entries.
 *
 * The single-row version above and this one are the same operation; the only
 * real difference is that a mistake here is larger, so the two safeguards that
 * matter are kept rather than relaxed:
 *
 *   - Same permission. There is no bulk-specific grant to hand out by
 *     accident; if you can clear one entry you can clear a page of them, and
 *     if you cannot, neither.
 *   - One scar per deletion, carrying *every* removed row's summary, actor and
 *     time — not a count. A replacement entry reading "deleted 40 entries"
 *     would record that something was removed while erasing what it was.
 *
 * `MAX_PAGE_SIZE` is the ceiling because the selection is drawn from one
 * rendered page and cannot legitimately exceed it. It is a sanity bound on a
 * hand-posted request, not a retention policy.
 */
export async function deleteAuditEntriesAction(
  _previous: SettingActionState,
  formData: FormData,
): Promise<SettingActionState> {
  const user = await requirePermission(PERMISSIONS.AUDIT_LOG_DELETE);

  const ids = [
    ...new Set(
      String(formData.get("ids") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];

  if (ids.length === 0) return { error: "Nothing was selected." };

  if (ids.length > MAX_PAGE_SIZE) {
    return {
      error: `Select at most ${MAX_PAGE_SIZE} entries at a time.`,
    };
  }

  const entries = await prisma.auditLog.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      summary: true,
      entityType: true,
      entityId: true,
      createdAt: true,
      adminUser: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (entries.length === 0) {
    return { error: "Those entries no longer exist." };
  }

  try {
    // Deleted by the ids actually found, so a row removed between the read and
    // the write is simply absent from the record rather than claimed as gone.
    const { count } = await prisma.auditLog.deleteMany({
      where: { id: { in: entries.map((entry) => entry.id) } },
    });

    await recordAudit({
      action: AuditAction.DELETE,
      entityType: "AuditLog",
      // No single row to point at. The ids are in `changes` below; this names
      // the actor's selection so the entry is not pointing at nothing.
      entityId: `bulk:${user.id}`,
      adminUserId: user.id,
      summary: `Deleted ${count} audit ${count === 1 ? "entry" : "entries"}`,
      changes: {
        deletedEntries: {
          before: entries.map((entry) => ({
            id: entry.id,
            summary: entry.summary,
            entityType: entry.entityType,
            entityId: entry.entityId,
            actor: entry.adminUser?.name ?? "Unknown",
            at: entry.createdAt.toISOString(),
          })),
          after: null,
        },
      },
    });

    revalidatePath("/admin/audit-logs");
    return {
      success: `${count} ${count === 1 ? "entry" : "entries"} deleted. The deletion is itself recorded.`,
    };
  } catch (error) {
    log.error({ err: error, count: ids.length }, "Failed to delete audit entries");
    return { error: "The entries could not be deleted." };
  }
}
