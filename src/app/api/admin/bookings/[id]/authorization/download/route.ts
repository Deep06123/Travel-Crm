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
import { previewAuthorizationEmail } from "@/server/services/booking-authorization-service";
import { signedAuthorizationPdf } from "@/server/services/signature-confirmation-service";

/** See the admin layout: a cold start must build the embedded database first. */
export const maxDuration = 60;

const log = loggerFor("authorization-download");

/**
 * The authorization for one booking, as a file.
 *
 * Which file depends on what exists, and the route decides — never the caller.
 * A signed booking yields the signed PDF with the captured evidence; one that
 * has not been signed yields the email itself, so an agent can keep or forward
 * exactly what the customer was asked to agree to. The alternative — a button
 * that does nothing on most rows — would be a worse answer than either.
 *
 * `booking.signature.send`, the same permission the email takes and the same
 * one the preview page takes. Both documents carry the card's last four and
 * the billing address, so reading one is the same disclosure as sending one;
 * a weaker gate here would be a way around the stronger gate there.
 *
 * Re-checked on this request rather than inherited from whatever the page
 * believed when it rendered the row.
 */

/** Strips anything that could break out of the Content-Disposition header. */
function safeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "authorization";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let viewerId: string;

  try {
    const user = await requireAuthOrThrow();
    viewerId = user.id;

    const granted = await getPermissionsForRole(user.role);
    if (!granted.has(PERMISSIONS.BOOKING_SIGNATURE_SEND)) {
      throw new ForbiddenError(PERMISSIONS.BOOKING_SIGNATURE_SEND);
    }
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await context.params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, bookingNumber: true },
  });

  if (!booking) {
    return new Response("Not found", { status: 404 });
  }

  // Never cached by a proxy or written to the browser's disk cache: these are
  // per-user authorised reads of a document carrying billing detail, not
  // public assets. Shared by both branches below.
  const commonHeaders = {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    // Blocks any embedded script or plugin inside the PDF, and any network
    // access at all from the saved HTML.
    "Content-Security-Policy":
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'none'; sandbox",
  };

  let signed: Awaited<ReturnType<typeof signedAuthorizationPdf>>;

  try {
    signed = await signedAuthorizationPdf(id);
  } catch (error) {
    // Storage is unreachable or the render failed. The email below is built
    // from the database alone, so it is still a usable answer — and a worse
    // one silently substituted is exactly the failure to avoid, so this is
    // logged rather than swallowed.
    log.error(
      { err: error, bookingId: id },
      "Signed authorization PDF could not be read; falling back to the email",
    );
    signed = null;
  }

  if (signed) {
    await recordAudit({
      action: AuditAction.VIEW_SENSITIVE,
      entityType: "Booking",
      entityId: id,
      adminUserId: viewerId,
      summary: `Downloaded the signed authorization for booking ${booking.bookingNumber}`,
    });

    return new Response(new Uint8Array(signed.bytes), {
      status: 200,
      headers: {
        ...commonHeaders,
        "Content-Type": "application/pdf",
        "Content-Length": String(signed.bytes.byteLength),
        "Content-Disposition": `attachment; filename="${safeFileName(signed.filename)}"`,
      },
    });
  }

  // Not signed. The email as the customer would receive it — rendered, not
  // sent, and minting no token: issuing one here would revoke whatever link
  // the customer is already holding, which is not a thing a download should
  // do. `previewAuthorizationEmail` is the same function the preview page
  // uses, so this is the message rather than a drawing of it.
  const preview = await previewAuthorizationEmail(id);

  if (!preview) {
    return new Response("Not found", { status: 404 });
  }

  await recordAudit({
    action: AuditAction.VIEW_SENSITIVE,
    entityType: "Booking",
    entityId: id,
    adminUserId: viewerId,
    summary: `Downloaded the unsigned authorization email for booking ${booking.bookingNumber}`,
  });

  const body = new TextEncoder().encode(preview.html);
  const filename = `authorization-${booking.bookingNumber}.html`;

  return new Response(body, {
    status: 200,
    headers: {
      ...commonHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(body.byteLength),
      // Always an attachment. This is untrusted-shaped markup built from
      // booking fields, and rendering it inline would run it on this origin
      // in the operator's own session.
      "Content-Disposition": `attachment; filename="${safeFileName(filename)}"`,
    },
  });
}
