"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/dal";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  NoRecipientsError,
  composeMessage,
  markMessageRead,
  saveMessageGroup,
} from "@/server/services/messaging-service";

const log = loggerFor("messaging-actions");

export interface MessageFormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

const composeSchema = z.object({
  subject: z.string().trim().min(1, "Enter a subject.").max(200),
  body: z.string().trim().min(1, "Enter a message.").max(20_000),
  groupId: z.string().trim().optional(),
  bookingId: z.string().trim().optional(),
  intent: z.enum(["send", "draft"]).default("send"),
});

function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

export async function composeMessageAction(
  _previous: MessageFormState,
  formData: FormData,
): Promise<MessageFormState> {
  const user = await requirePermission(PERMISSIONS.MESSAGE_SEND);

  const parsed = composeSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors, values: formValues(formData) };
  }

  // Checkboxes arrive as repeated entries, so they are read separately.
  const recipientIds = formData
    .getAll("recipientIds")
    .filter((value): value is string => typeof value === "string" && value !== "");

  let result: { id: string; recipientCount: number };

  try {
    result = await composeMessage(
      {
        subject: parsed.data.subject,
        body: parsed.data.body,
        recipientIds,
        groupId: parsed.data.groupId || undefined,
        bookingId: parsed.data.bookingId || undefined,
        send: parsed.data.intent === "send",
      },
      user.id,
    );
  } catch (error) {
    if (error instanceof NoRecipientsError) {
      return { error: error.message, values: formValues(formData) };
    }

    log.error({ err: error }, "Failed to compose message");
    return {
      error: "The message could not be saved. Try again.",
      values: formValues(formData),
    };
  }

  revalidatePath("/admin/messages");
  revalidatePath("/admin/messages/sent");

  if (parsed.data.intent === "draft") {
    return { success: "Draft saved. It has no recipients and has not been sent." };
  }

  redirect(`/admin/messages/sent?sent=${result.recipientCount}`);
}

const readSchema = z.object({ messageId: z.string().trim().min(1) });

export async function markReadAction(
  _previous: MessageFormState,
  formData: FormData,
): Promise<MessageFormState> {
  const user = await requirePermission(PERMISSIONS.MESSAGE_VIEW);

  const parsed = readSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid request." };

  // Scoped to the caller, so one administrator cannot mark another's mail read.
  await markMessageRead(parsed.data.messageId, user.id);

  revalidatePath("/admin/messages");
  return {};
}

const groupSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(1, "Enter a name.").max(120),
  description: z.string().trim().max(500).optional(),
  isActive: z.coerce.boolean().default(true),
});

export async function saveMessageGroupAction(
  _previous: MessageFormState,
  formData: FormData,
): Promise<MessageFormState> {
  const user = await requirePermission(PERMISSIONS.MESSAGE_GROUP_MANAGE);

  const parsed = groupSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const memberIds = formData
    .getAll("memberIds")
    .filter((value): value is string => typeof value === "string" && value !== "");

  try {
    await saveMessageGroup(
      {
        name: parsed.data.name,
        description: parsed.data.description || undefined,
        memberIds,
        isActive: parsed.data.isActive,
      },
      user.id,
      parsed.data.id || undefined,
    );
  } catch (error) {
    log.error({ err: error }, "Failed to save message group");
    return { error: "The group could not be saved. A name must be unique." };
  }

  revalidatePath("/admin/messages/groups");
  return { success: parsed.data.id ? "Group updated." : "Group created." };
}
