"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AuditAction } from "@/generated/prisma/enums";
import { diffFields, recordAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";

const log = loggerFor("profile-actions");

export interface ProfileFormState {
  error?: string;
  success?: string;
}

/**
 * What a person may change about their own account.
 *
 * Name and phone, and nothing else. Role and status are the two fields that
 * decide what this account can do, so they stay where the agents screen puts
 * them — an account that can promote itself is not access control. Email and
 * username are the sign-in identity and are administrator-set for the same
 * reason: changing your own email is a password-reset path.
 *
 * `requireAuth`, not a permission: everyone with an account has one of these,
 * including a role holding nothing else.
 */
const schema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  phone: z.string().trim().max(40).optional(),
});

export async function updateOwnProfileAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const user = await requireAuth();

  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  const after = {
    name: parsed.data.name,
    phone: parsed.data.phone?.trim() || null,
  };

  try {
    const before = await prisma.adminUser.findUniqueOrThrow({
      where: { id: user.id },
      select: { name: true, phone: true },
    });

    const changes = diffFields(before, after);

    // Nothing changed, so nothing is written and nothing is audited. A trail
    // full of no-op edits is harder to read than one without them.
    if (Object.keys(changes).length === 0) {
      return { success: "No changes to save." };
    }

    await prisma.adminUser.update({ where: { id: user.id }, data: after });

    await recordAudit({
      action: AuditAction.UPDATE,
      entityType: "AdminUser",
      entityId: user.id,
      adminUserId: user.id,
      summary: "Updated their own profile",
      changes,
    });
  } catch (error) {
    log.error({ err: error, userId: user.id }, "Failed to update own profile");
    return { error: "The changes could not be saved. Try again." };
  }

  revalidatePath("/admin/profile");
  // The name is in the header on every page, so the shell has to redraw too.
  revalidatePath("/admin", "layout");

  return { success: "Profile updated." };
}
