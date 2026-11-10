"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/dal";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  createMailAccount,
  deleteMailAccount,
  MAIL_PURPOSES,
  MailAccountValidationError,
  savePurposeDefaults,
  updateMailAccount,
  verifyMailAccount,
} from "@/server/services/mail-account-service";

const log = loggerFor("mail-account-actions");

/**
 * Managing the mailboxes customer email is sent from.
 *
 * Everything here takes `settings.manage`. These forms hold an SMTP password
 * and decide which address a customer sees — the same class of decision as
 * the notification addresses next to them, and not something `message.send`
 * should carry.
 */

export interface MailAccountFormState {
  error?: string;
  success?: string;
  /** Echoed back so the page can reopen the form that failed. */
  editingId?: string;
}

const accountSchema = z.object({
  // Empty on the "add" form; present when editing an existing row.
  id: z.string().trim().optional(),
  label: z.string().trim().min(1).max(80),
  fromEmail: z.string().trim().min(1).max(200),
  fromName: z.string().trim().max(120).optional(),
  replyTo: z.string().trim().max(200).optional(),
  host: z.string().trim().min(1).max(200),
  port: z.coerce.number().int().min(1).max(65_535),
  // Checkboxes post nothing when unticked, which is the absence these read.
  secure: z.literal("on").optional(),
  isActive: z.literal("on").optional(),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(400).optional(),
  /** Ticked to remove a stored credential, for a relay that needs none. */
  clearPassword: z.literal("on").optional(),

  // Sent-folder copy. The port has a default because the field is only shown
  // once the box is ticked, so an untouched form posts nothing for it.
  saveToSent: z.literal("on").optional(),
  imapHost: z.string().trim().max(200).optional(),
  imapPort: z.coerce.number().int().min(1).max(65_535).default(993),
  imapSecure: z.literal("on").optional(),
  sentFolder: z.string().trim().max(200).optional(),
});

export async function saveMailAccountAction(
  _previous: MailAccountFormState,
  formData: FormData,
): Promise<MailAccountFormState> {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);

  const parsed = accountSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return { error: "Check the account details and try again." };
  }

  const {
    id,
    password,
    secure,
    isActive,
    clearPassword,
    saveToSent,
    imapSecure,
    ...rest
  } = parsed.data;

  const input = {
    ...rest,
    secure: secure === "on",
    isActive: isActive === "on",
    saveToSent: saveToSent === "on",
    imapSecure: imapSecure === "on",
    // An edit posts an empty password box when the operator did not retype
    // the credential, and that must not wipe a working one. `undefined` means
    // "leave it alone"; the clear checkbox is how you ask for removal.
    ...(clearPassword === "on"
      ? { password: "" }
      : id && !password
        ? {}
        : { password: password ?? "" }),
  };

  try {
    if (id) {
      await updateMailAccount(id, input, user.id);
    } else {
      await createMailAccount(input, user.id);
    }
  } catch (error) {
    if (error instanceof MailAccountValidationError) {
      return { error: error.message, ...(id ? { editingId: id } : {}) };
    }

    log.error({ err: error, mailAccountId: id }, "Could not save mail account");
    return { error: "The account could not be saved. Please try again." };
  }

  revalidatePath("/admin/settings");

  return {
    success: id
      ? `Saved "${input.label}". Use Test connection to confirm the credentials still work.`
      : `Added "${input.label}". Test the connection before sending from it.`,
  };
}

export async function deleteMailAccountAction(
  _previous: MailAccountFormState,
  formData: FormData,
): Promise<MailAccountFormState> {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Invalid request." };

  try {
    await deleteMailAccount(id, user.id);
  } catch (error) {
    log.error({ err: error, mailAccountId: id }, "Could not delete mail account");
    return { error: "The account could not be deleted." };
  }

  revalidatePath("/admin/settings");

  return {
    success:
      "Account deleted. The emails it sent keep their records and still show what went out.",
  };
}

/** Opens a connection and authenticates. Sends nothing. */
export async function verifyMailAccountAction(
  _previous: MailAccountFormState,
  formData: FormData,
): Promise<MailAccountFormState> {
  await requirePermission(PERMISSIONS.SETTINGS_MANAGE);

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Invalid request." };

  const outcome = await verifyMailAccount(id);

  revalidatePath("/admin/settings");

  return outcome.ok
    ? { success: "Connected and authenticated. Nothing was sent." }
    : { error: `The server refused the connection: ${outcome.reason}` };
}

/** Which account each kind of customer email goes out from by default. */
export async function saveMailDefaultsAction(
  _previous: MailAccountFormState,
  formData: FormData,
): Promise<MailAccountFormState> {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);

  const defaults: Record<string, string | null> = {};

  for (const purpose of MAIL_PURPOSES) {
    const value = String(formData.get(purpose) ?? "").trim();
    defaults[purpose] = value === "" ? null : value;
  }

  try {
    await savePurposeDefaults(defaults, user.id);
  } catch (error) {
    if (error instanceof MailAccountValidationError) {
      return { error: error.message };
    }

    log.error({ err: error }, "Could not save mail defaults");
    return { error: "The defaults could not be saved. Please try again." };
  }

  revalidatePath("/admin/settings");

  return { success: "Saved. New emails use these senders unless one is picked at send time." };
}
