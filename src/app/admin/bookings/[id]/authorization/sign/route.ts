import { notFound, redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { isProduction } from "@/lib/env";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { createSignatureRequest } from "@/server/services/booking-signature-service";

const log = loggerFor("authorization-preview-sign");

/**
 * Development only: mints a signing link and opens it.
 *
 * It exists because the signing page is otherwise unreachable without a
 * mailbox. Tokens are stored as a SHA-256 and the raw value leaves the server
 * exactly once, inside the emailed link — so on a machine with
 * `MAIL_DRIVER="none"` there is no way to see the page a customer sees except
 * by digging the URL out of the server log. This turns that into a click.
 *
 * Three things keep it from being a hole:
 *
 * `isProduction()` is the first check, and it 404s rather than explaining
 * itself — a deployment that somehow kept this file must not advertise it.
 * The guard is the environment rather than the absence of a mailer, so a
 * production deployment that loses its SMTP settings cannot start handing out
 * signing links.
 *
 * It still takes `booking.signature.send`. Minting a token is sending, as far
 * as the authorization model is concerned, whoever ends up holding it.
 *
 * And it is honest about the cost: `createSignatureRequest` revokes every
 * unsigned link for the booking, exactly as a resend does. In development that
 * is the point — the newest link is the one you just opened. The preview page
 * says so above the button.
 *
 * A GET with a side effect, which is normally the wrong shape. Accepted here
 * because the alternative is a form posting out of a sandboxed iframe, and the
 * side effect is one a developer is explicitly asking for on their own machine.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/admin/bookings/[id]/authorization/sign">,
) {
  if (isProduction()) notFound();

  const user = await requirePermission(PERMISSIONS.BOOKING_SIGNATURE_SEND);

  const { id } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      contactEmail: true,
      customer: { select: { email: true } },
    },
  });

  if (!booking) notFound();

  // Recorded on the row as "who this was sent to". There may be nobody —
  // that is the state most local bookings are in, and it must not stop the
  // page being reachable, so the address says plainly that nothing was sent.
  const recipient =
    booking.contactEmail?.trim() ||
    booking.customer.email?.trim() ||
    "not-sent@local.preview";

  const { token } = await createSignatureRequest(booking.id, recipient, user.id);

  log.warn(
    { bookingId: booking.id, actorId: user.id },
    "Development build: signing link minted from the authorization preview",
  );

  redirect(`/sign/${encodeURIComponent(token)}`);
}
