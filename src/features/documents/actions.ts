"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  DocumentCategory,
  DocumentOrigin,
  DocumentVerificationStatus,
} from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/dal";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  FileTooLargeError,
  UnsupportedFileTypeError,
  uploadDocument,
  verifyDocument,
} from "@/server/services/document-service";

const log = loggerFor("document-actions");

export interface DocumentFormState {
  error?: string;
  success?: string;
}

const uploadSchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(200),
  category: z.enum(DocumentCategory),
  origin: z.enum(DocumentOrigin),
  bookingId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  customerId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  documentId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
});

export async function uploadDocumentAction(
  _previous: DocumentFormState,
  formData: FormData,
): Promise<DocumentFormState> {
  const user = await requirePermission(PERMISSIONS.DOCUMENT_UPLOAD);

  const parsed = uploadSchema.safeParse({
    title: formData.get("title"),
    category: formData.get("category"),
    origin: formData.get("origin"),
    bookingId: formData.get("bookingId") ?? "",
    customerId: formData.get("customerId") ?? "",
    documentId: formData.get("documentId") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid upload." };
  }

  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  try {
    await uploadDocument({ ...parsed.data, file }, user.id);
  } catch (error) {
    // These two carry a message written for the operator, so they are shown
    // as-is; anything else is logged and reported generically.
    if (
      error instanceof UnsupportedFileTypeError ||
      error instanceof FileTooLargeError
    ) {
      return { error: error.message };
    }

    log.error({ err: error }, "Document upload failed");
    return { error: "The upload failed. Try again." };
  }

  revalidatePath("/admin/documents");
  if (parsed.data.bookingId) {
    revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
  }
  if (parsed.data.customerId) {
    revalidatePath(`/admin/customers/${parsed.data.customerId}`);
  }

  return { success: "Document uploaded." };
}

const verifySchema = z.object({
  documentId: z.string().trim().min(1),
  status: z.enum(DocumentVerificationStatus),
  notes: z.string().trim().max(2_000).optional(),
});

export async function verifyDocumentAction(
  _previous: DocumentFormState,
  formData: FormData,
): Promise<DocumentFormState> {
  const user = await requirePermission(PERMISSIONS.DOCUMENT_VERIFY);

  const parsed = verifySchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await verifyDocument(
      parsed.data.documentId,
      parsed.data.status,
      parsed.data.notes,
      user.id,
    );
  } catch (error) {
    log.error(
      { err: error, documentId: parsed.data.documentId },
      "Document verification failed",
    );
    return { error: "The document could not be updated. Try again." };
  }

  revalidatePath("/admin/documents");
  return {
    success:
      parsed.data.status === DocumentVerificationStatus.VERIFIED
        ? "Document marked verified."
        : "Document marked rejected.",
  };
}
