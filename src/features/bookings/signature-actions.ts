"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/dal";
import { getEnv } from "@/lib/env";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { sendAuthorizationEmail } from "@/server/services/booking-authorization-service";

const log = loggerFor("booking-signature-actions");

const schema = z.object({ bookingId: z.string().min(1) });

export interface AuthorizationState {
  error?: string;
  success?: string;
}

/**
 * The origin the signing link is built against.
 *
 * `AUTH_URL` wins when it is set, because a deployment behind a proxy knows
 * its public address and the request headers may not. Where it is absent the
 * current request's own host is the next best answer — this action only ever
 * runs inside one. Both are server-controlled; nothing a customer sends can
 * steer the link into someone else's domain.
 */
async function resolveOrigin(): Promise<string> {
  const configured = getEnv().AUTH_URL?.trim();
  if (configured) return new URL(configured).origin;

  const headerList = await headers();
  const host = headerList.get("host");

  if (!host) {
    throw new Error(
      "Cannot build a signing link: no AUTH_URL is configured and the request carries no host header.",
    );
  }

  const protocol =
    headerList.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${protocol}://${host}`;
}

/**
 * Emails the customer their authorization and e-signature link.
 *
 * Takes `booking.signature.send` rather than `message.send`: this mints a
 * token that shows booking detail to whoever opens the link, which an ordinary
 * customer email does not.
 *
 * Awaited, not dispatched, so the agent is told whether the message left.
 */
export async function sendAuthorizationEmailAction(
  _previous: AuthorizationState,
  formData: FormData,
): Promise<AuthorizationState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_SIGNATURE_SEND);

  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid request." };

  const { bookingId } = parsed.data;

  try {
    const outcome = await sendAuthorizationEmail({
      bookingId,
      actorId: user.id,
      origin: await resolveOrigin(),
    });

    revalidatePath(`/admin/bookings/${bookingId}`);

    switch (outcome.result) {
      case "sent":
        return {
          success: `Authorization email sent to ${outcome.recipient}. The link works until ${outcome.expiresAt.toLocaleDateString("en-GB")}.`,
        };
      case "suppressed":
        return { error: outcome.reason };
      case "failed":
        return { error: `The email was not accepted: ${outcome.reason}` };
    }
  } catch (error) {
    log.error({ err: error, bookingId }, "Authorization send failed");
    return { error: "The authorization email could not be sent. Try again." };
  }
}
