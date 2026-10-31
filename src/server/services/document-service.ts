import "server-only";

import { extname } from "node:path";

import {
  AuditAction,
  DocumentCategory,
  DocumentOrigin,
  DocumentVerificationStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";
import {
  paginate,
  toPageRequest,
  type Paginated,
  type PaginationInput,
} from "@/lib/pagination";
import { generateStorageKey, getStorage } from "@/lib/storage";

const log = loggerFor("document-service");

/**
 * Documents.
 *
 * Bytes go to private object storage; only metadata and an opaque key are kept
 * in MySQL. Nothing here ever returns a public URL — reads go through the
 * protected route handler, which re-checks permissions on every fetch.
 */

/** Content types accepted for upload, mapped to their canonical extension. */
const ALLOWED_CONTENT_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Hard ceiling, independent of the configurable business setting. */
const ABSOLUTE_MAX_BYTES = 25 * 1024 * 1024;

export class UnsupportedFileTypeError extends Error {
  constructor(contentType: string) {
    super(
      `${contentType || "That file type"} cannot be uploaded. Accepted types: PDF, PNG, JPEG, WebP.`,
    );
    this.name = "UnsupportedFileTypeError";
  }
}

export class FileTooLargeError extends Error {
  constructor(sizeBytes: number, maxBytes: number) {
    const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
    super(`That file is ${mb(sizeBytes)} MB. The limit is ${mb(maxBytes)} MB.`);
    this.name = "FileTooLargeError";
  }
}

/**
 * Confirms the bytes really are what the content type claims.
 *
 * A browser-supplied content type is attacker-controlled. Checking the magic
 * bytes stops an HTML or script payload being stored as `image/png` and later
 * served back — which, even from a protected endpoint, would run in the
 * viewer's session.
 */
function sniffContentType(body: Buffer): string | null {
  if (body.length < 12) return null;

  // %PDF
  if (body.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";

  // \x89PNG\r\n\x1a\n
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }

  // JPEG SOI marker
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";

  // RIFF....WEBP
  if (
    body.subarray(0, 4).toString("ascii") === "RIFF" &&
    body.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

async function maxUploadBytes(): Promise<number> {
  const setting = await prisma.businessSetting.findUnique({
    where: { key: "document_max_bytes" },
    select: { value: true },
  });

  const configured = typeof setting?.value === "number" ? setting.value : ABSOLUTE_MAX_BYTES;
  return Math.min(configured, ABSOLUTE_MAX_BYTES);
}

export interface UploadDocumentInput {
  file: File;
  title: string;
  category: DocumentCategory;
  origin: DocumentOrigin;
  bookingId?: string | undefined;
  customerId?: string | undefined;
  /** Supplied to add a new version to an existing document instead of creating one. */
  documentId?: string | undefined;
}

/**
 * Why a file would be rejected, or `null` if it looks uploadable.
 *
 * Judged from what the browser declared, so it is a pre-flight check and not a
 * substitute for `uploadDocument`, which still sniffs the bytes and re-checks
 * the size against them. It exists for callers that attach documents as part of
 * a larger write — creating a booking, say — and need to fail the whole form
 * *before* the booking row exists rather than after, when there is no longer
 * anything to return the operator to.
 */
export async function describeUploadProblem(file: File): Promise<string | null> {
  if (!ALLOWED_CONTENT_TYPES[file.type]) {
    return new UnsupportedFileTypeError(file.type).message;
  }

  const limit = await maxUploadBytes();
  if (file.size > limit) {
    return new FileTooLargeError(file.size, limit).message;
  }

  return null;
}

export async function uploadDocument(
  input: UploadDocumentInput,
  actorId: string,
): Promise<{ documentId: string; version: number }> {
  const declaredType = input.file.type;

  if (!ALLOWED_CONTENT_TYPES[declaredType]) {
    throw new UnsupportedFileTypeError(declaredType);
  }

  const limit = await maxUploadBytes();
  if (input.file.size > limit) {
    throw new FileTooLargeError(input.file.size, limit);
  }

  const body = Buffer.from(await input.file.arrayBuffer());

  // Re-check the size against the actual bytes; `File.size` is client-reported.
  if (body.byteLength > limit) {
    throw new FileTooLargeError(body.byteLength, limit);
  }

  const sniffed = sniffContentType(body);
  if (sniffed === null || sniffed !== declaredType) {
    throw new UnsupportedFileTypeError(declaredType);
  }

  const extension =
    ALLOWED_CONTENT_TYPES[sniffed] ?? extname(input.file.name).replace(".", "");
  const key = generateStorageKey(extension);

  const storage = getStorage();
  const stored = await storage.put({ key, body, contentType: sniffed });

  try {
    return await prisma.$transaction(async (tx) => {
      const documentId =
        input.documentId ??
        (
          await tx.document.create({
            data: {
              title: input.title,
              category: input.category,
              origin: input.origin,
              bookingId: input.bookingId ?? null,
              customerId: input.customerId ?? null,
              uploadedById: actorId,
            },
            select: { id: true },
          })
        ).id;

      const previous = await tx.documentVersion.findFirst({
        where: { documentId },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      const version = (previous?.version ?? 0) + 1;

      const created = await tx.documentVersion.create({
        data: {
          documentId,
          version,
          storageKey: stored.key,
          // Kept for display only. The stored key is unrelated to it, so the
          // original name never becomes part of a path or a URL.
          fileName: input.file.name,
          contentType: sniffed,
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
          uploadedById: actorId,
        },
        select: { id: true },
      });

      await tx.document.update({
        where: { id: documentId },
        data: {
          currentVersionId: created.id,
          // A new version invalidates a previous verification: nobody has
          // checked these bytes yet.
          verificationStatus: DocumentVerificationStatus.UNVERIFIED,
          verifiedById: null,
          verifiedAt: null,
        },
      });

      await recordAudit(
        {
          action: input.documentId ? AuditAction.UPDATE : AuditAction.CREATE,
          entityType: "Document",
          entityId: documentId,
          adminUserId: actorId,
          // The filename is deliberately omitted — it may contain a passenger
          // name, and the audit trail is widely readable.
          summary: `Document ${input.documentId ? "version added" : "uploaded"}: ${input.category} v${version}`,
        },
        tx,
      );

      return { documentId, version };
    });
  } catch (error) {
    // The bytes landed but the metadata did not, so remove the orphan rather
    // than leave an unreferenced object in storage forever.
    await getStorage()
      .delete(stored.key)
      .catch((cleanupError: unknown) => {
        log.error({ err: cleanupError }, "Failed to clean up orphaned object");
      });

    throw error;
  }
}

/**
 * Loads a document version's bytes for an authorised viewer.
 *
 * Returns null when the document or its current version is missing. The caller
 * is responsible for the permission check — this is reached only from the
 * protected route handler.
 */
export async function readDocumentVersion(
  documentId: string,
  versionNumber?: number,
): Promise<
  | {
      body: Buffer;
      contentType: string;
      fileName: string;
      sizeBytes: number;
    }
  | null
> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      currentVersionId: true,
      versions: {
        where: versionNumber === undefined ? undefined : { version: versionNumber },
        orderBy: { version: "desc" },
        select: {
          id: true,
          storageKey: true,
          contentType: true,
          fileName: true,
          sizeBytes: true,
          version: true,
        },
      },
    },
  });

  if (!document) return null;

  const target =
    versionNumber === undefined
      ? (document.versions.find((v) => v.id === document.currentVersionId) ??
        document.versions[0])
      : document.versions[0];

  if (!target) return null;

  const body = await getStorage().get(target.storageKey);

  return {
    body,
    contentType: target.contentType,
    fileName: target.fileName,
    sizeBytes: target.sizeBytes,
  };
}

export async function verifyDocument(
  documentId: string,
  status: DocumentVerificationStatus,
  notes: string | undefined,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: {
        verificationStatus: status,
        verifiedById: actorId,
        verifiedAt: new Date(),
        verificationNotes: notes ?? null,
      },
    });

    await recordAudit(
      {
        action:
          status === DocumentVerificationStatus.VERIFIED
            ? AuditAction.APPROVE
            : AuditAction.REJECT,
        entityType: "Document",
        entityId: documentId,
        adminUserId: actorId,
        summary: `Document marked ${status}`,
      },
      tx,
    );
  });
}

export interface DocumentListFilters {
  q?: string | undefined;
  category?: DocumentCategory | undefined;
  verificationStatus?: DocumentVerificationStatus | undefined;
  bookingId?: string | undefined;
  customerId?: string | undefined;
}

export async function listDocuments(
  filters: DocumentListFilters,
  pagination: PaginationInput,
) {
  const where: Prisma.DocumentWhereInput = {};

  if (filters.category) where.category = filters.category;
  if (filters.verificationStatus) where.verificationStatus = filters.verificationStatus;
  if (filters.bookingId) where.bookingId = filters.bookingId;
  if (filters.customerId) where.customerId = filters.customerId;

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { title: { contains: term } },
      { booking: { bookingNumber: { contains: term } } },
      { customer: { reference: { contains: term } } },
      { customer: { lastName: { contains: term } } },
    ];
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        title: true,
        category: true,
        origin: true,
        verificationStatus: true,
        createdAt: true,
        booking: { select: { id: true, bookingNumber: true } },
        customer: { select: { id: true, reference: true, lastName: true } },
        uploadedBy: { select: { name: true } },
        currentVersion: {
          select: { version: true, contentType: true, sizeBytes: true, fileName: true },
        },
        _count: { select: { versions: true } },
      },
    }),
    prisma.document.count({ where }),
  ]);

  return paginate(rows, total, pagination) as Paginated<(typeof rows)[number]>;
}

export { ALLOWED_CONTENT_TYPES };
