"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/dal";
import { getEnv } from "@/lib/env";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  previewAuthorizationEmail,
  sendAuthorizationEmail,
} from "@/server/services/booking-authorization-service";

const log = loggerFor("booking-signature-actions");

const schema = z.object({
  bookingId: z.string().min(1),
  intent: z.enum(["preview", "send"]).default("send"),
  // Which configured identity to send from. Empty means "whatever the
  // settings say for an authorization" — the select's first option.
  mailAccountId: z.string().trim().min(1).optional(),
  // Present only when the operator edited the message in the preview. Both
  // must arrive together — a subject with no body, or the reverse, is a
  // half-built message rather than an edit.
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
});

/**
 * One state for preview and send, as in `bookingEmailAction`.
 *
 * With two actions nothing on the page could tell which had run most recently,
 * so the editor had to be mirrored into local state and cleared from an effect.
 * Sharing the state makes the rule trivial: a result carrying `preview` opens
 * the editor, and any other result closes it.
 */
export interface AuthorizationState {
  error?: string;
  success?: string;
  preview?: {
    recipient: string;
    subject: string;
    body: string;
  };
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

  const { bookingId, intent, subject, body, mailAccountId } = parsed.data;

  // Reading is not sending: no token is minted, nothing is written and nothing
  // is transmitted. It takes the same permission because it exposes the exact
  // wording, the card's last four and the billing address.
  if (intent === "preview") {
    try {
      const preview = await previewAuthorizationEmail(bookingId, {
        subject,
        body,
      });

      if (!preview) return { error: "That booking no longer exists." };

      const { recipient, subject: previewSubject, body: previewBody } = preview;
      return {
        preview: { recipient, subject: previewSubject, body: previewBody },
      };
    } catch (error) {
      log.error({ err: error, bookingId }, "Authorization preview failed");
      return { error: "The preview could not be built." };
    }
  }

  // Both halves or neither. Sending a generated message under an edited
  // subject would be an email nobody wrote.
  if ((subject === undefined) !== (body === undefined)) {
    return { error: "An edited email needs both a subject and a message." };
  }

  try {
    const outcome = await sendAuthorizationEmail({
      bookingId,
      actorId: user.id,
      origin: await resolveOrigin(),
      override: { subject, body },
      ...(mailAccountId ? { mailAccountId } : {}),
    });

    revalidatePath(`/admin/bookings/${bookingId}`);

    switch (outcome.result) {
      case "sent":
        return {
          success: `Authorization email sent to ${outcome.recipient} from ${outcome.sentFrom}. The link works until ${outcome.expiresAt.toLocaleDateString("en-GB")}.`,
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
