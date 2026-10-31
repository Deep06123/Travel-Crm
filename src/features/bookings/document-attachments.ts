import "server-only";

import { DocumentCategory, DocumentOrigin } from "@/generated/prisma/enums";
import { currentUserCan } from "@/lib/auth/dal";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  describeUploadProblem,
  uploadDocument,
} from "@/server/services/document-service";

import { BOOKING_DOCUMENTS_FIELD } from "./document-attachments.constants";

const log = loggerFor("booking-document-attachments");

/**
 * Documents attached while a booking is being created.
 *
 * The booking form carries the files itself rather than linking out to the
 * documents module, because the confirmation and the passport scan are on the
 * agent's desk during the call — asking them to save the booking, find it
 * again and upload separately is how attachments end up never being made.
 *
 * A document needs a booking to hang off, so the files cannot be stored until
 * the booking row exists. That ordering is the awkward part: once the booking
 * is created there is nothing to return the operator to, so a late failure
 * cannot be shown on the form they have already left. Hence two passes —
 * everything knowable up front (`validateBookingDocuments`) is checked before
 * the booking is written, and `attachBookingDocuments` afterwards reports what
 * is left over through the redirect rather than swallowing it.
 */

/** Files actually chosen — an empty file input still posts a zero-byte entry. */
export function selectedDocuments(formData: FormData): File[] {
  return formData
    .getAll(BOOKING_DOCUMENTS_FIELD)
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

/** The first reason the chosen files cannot be stored, or `null` if they can. */
export async function validateBookingDocuments(
  files: readonly File[],
): Promise<string | null> {
  if (files.length === 0) return null;

  if (!(await currentUserCan(PERMISSIONS.DOCUMENT_UPLOAD))) {
    return "You do not have permission to upload documents.";
  }

  for (const file of files) {
    const problem = await describeUploadProblem(file);
    if (problem) return `${file.name}: ${problem}`;
  }

  return null;
}

function categoryFrom(formData: FormData): DocumentCategory {
  const raw = formData.get("documentCategory");
  return typeof raw === "string" && raw in DocumentCategory
    ? (raw as DocumentCategory)
    : DocumentCategory.BOOKING_CONFIRMATION;
}

function originFrom(formData: FormData): DocumentOrigin {
  const raw = formData.get("documentOrigin");
  return typeof raw === "string" && raw in DocumentOrigin
    ? (raw as DocumentOrigin)
    : DocumentOrigin.CUSTOMER_SUPPLIED;
}

/**
 * Stores the chosen files against a booking that has just been created.
 *
 * Returns the number that failed. The booking is already saved by this point,
 * so a failure here cannot undo it and must not throw: the caller reports the
 * count on the booking page instead, where the operator can retry the upload
 * against the booking that now exists.
 *
 * The title is the file name, which is what the operator recognises; the
 * documents module lets them rename it afterwards.
 */
export async function attachBookingDocuments(
  formData: FormData,
  files: readonly File[],
  bookingId: string,
  actorId: string,
): Promise<number> {
  const category = categoryFrom(formData);
  const origin = originFrom(formData);
  let failed = 0;

  for (const file of files) {
    try {
      await uploadDocument(
        {
          file,
          title: file.name.slice(0, 200),
          category,
          origin,
          bookingId,
        },
        actorId,
      );
    } catch (error) {
      failed += 1;
      log.error(
        { err: error, bookingId, fileName: file.name },
        "Failed to attach document to new booking",
      );
    }
  }

  return failed;
}
