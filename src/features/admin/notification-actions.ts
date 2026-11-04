"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/dal";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  AdminNotificationValidationError,
  saveAdminNotificationEmails,
} from "@/server/services/admin-notification-service";

const log = loggerFor("notification-actions");

export interface NotificationFormState {
  error?: string;
  success?: string;
  /** The stored list, so the form can redraw from what was saved. */
  addresses?: string[];
}

/**
 * Sets who receives the internal copy of a customer email.
 *
 * Takes `settings.manage` rather than `message.send`: this decides where
 * booking detail is copied to, which is a configuration decision about the
 * business, not a decision about one message.
 */
export async function saveNotificationEmailsAction(
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);

  const raw = String(formData.get("addresses") ?? "");

  let addresses: string[];

  try {
    addresses = await saveAdminNotificationEmails(raw, user.id);
  } catch (error) {
    if (error instanceof AdminNotificationValidationError) {
      return { error: error.message };
    }

    log.error({ err: error }, "Failed to save notification addresses");
    return { error: "The addresses could not be saved. Please try again." };
  }

  revalidatePath("/admin/settings");

  return {
    addresses,
    success:
      addresses.length === 0
        ? "Internal notifications are off. Nobody will be copied."
        : `Saved. Internal copies will go to ${addresses.join(", ")}.`,
  };
}
