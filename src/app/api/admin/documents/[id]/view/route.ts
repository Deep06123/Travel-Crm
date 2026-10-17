import { AuditAction } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { requireAuthOrThrow } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";
import {
  ForbiddenError,
  PERMISSIONS,
  getPermissionsForRole,
} from "@/lib/permissions";
import { ObjectNotFoundError } from "@/lib/storage";
import { readDocumentVersion } from "@/server/services/document-service";

const log = loggerFor("document-view");

/**
 * Protected document access.
 *
 * This is the ONLY way document bytes leave the server. There is no public URL
 * and no static path: storage lives outside the web root, so a document can be
 * read only by an authenticated administrator whose role holds
 * `document.view`, re-checked on every single fetch rather than once when the
 * page was rendered.
 *
 * Inline display is restricted to types a browser renders safely. Anything else
 * is sent as an attachment, so a crafted file cannot execute in the viewer's
 * session on this origin.
 */

/** Types safe to render inline. Everything else downloads. */
const INLINE_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/** Strips anything that could break out of the Content-Disposition header. */
function safeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let viewerId: string;

  try {
    const user = await requireAuthOrThrow();
    viewerId = user.id;

    const granted = await getPermissionsForRole(user.role);
    if (!granted.has(PERMISSIONS.DOCUMENT_VIEW)) {
      throw new ForbiddenError(PERMISSIONS.DOCUMENT_VIEW);
    }
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await context.params;

  const url = new URL(request.url);
  const rawVersion = url.searchParams.get("version");
  const version =
    rawVersion && /^\d+$/.test(rawVersion) ? Number(rawVersion) : undefined;
  const download = url.searchParams.get("download") === "1";

  const document = await prisma.document.findUnique({
    where: { id },
    select: { id: true, category: true },
  });

  if (!document) {
    return new Response("Not found", { status: 404 });
  }

  let file: Awaited<ReturnType<typeof readDocumentVersion>>;

  try {
    file = await readDocumentVersion(id, version);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      // Metadata exists but the bytes are gone — a storage problem, not a
      // client error, and worth alerting on.
      log.error({ documentId: id }, "Document metadata has no stored object");
      return new Response("Document file is unavailable", { status: 410 });
    }
    throw error;
  }

  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  // Reading a document is itself worth recording: these are confirmations,
  // invoices and identity evidence.
  await recordAudit({
    action: AuditAction.VIEW_SENSITIVE,
    entityType: "Document",
    entityId: id,
    adminUserId: viewerId,
    summary: `Viewed document (${document.category})`,
  });

  const disposition =
    download || !INLINE_CONTENT_TYPES.has(file.contentType)
      ? "attachment"
      : "inline";

  return new Response(new Uint8Array(file.body), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `${disposition}; filename="${safeFileName(file.fileName)}"`,
      // Never cached by a proxy or written to the browser's disk cache: these
      // are per-user authorised reads, not public assets.
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      // Blocks any embedded script or plugin inside a crafted PDF or SVG.
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; object-src 'none'; sandbox",
    },
  });
}
