"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/dal";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  BOOKING_CONFIRMED,
  BOOKING_TICKETED,
  previewBookingEmail,
  sendBookingEmail,
} from "@/server/services/customer-email-service";

const log = loggerFor("booking-email-actions");

const resendSchema = z.object({
  bookingId: z.string().min(1),
  event: z.enum([BOOKING_CONFIRMED, BOOKING_TICKETED]),
  intent: z.enum(["preview", "send"]).default("send"),
  // Present only when the operator edited the message in the preview. Both
  // must arrive together — a subject with no body, or the reverse, is a
  // half-built message rather than an edit.
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
});

/**
 * One state for both halves of the flow.
 *
 * Preview and send are deliberately a single action rather than two. With two,
 * nothing on the page could tell which had run most recently, so the editor
 * had to be mirrored into local state and cleared from an effect — and a
 * successful send left the form sitting open, one click away from sending the
 * same message twice. Sharing the state makes the rule trivial: a result
 * carrying `preview` opens the editor, and any other result closes it.
 */
export interface BookingEmailState {
  error?: string;
  success?: string;
  preview?: {
    event: string;
    recipient: string;
    subject: string;
    body: string;
  };
}

/**
 * Renders a lifecycle email so it can be read, and edited, before it is sent.
 *
 * Needs `message.send` rather than `booking.view`: the preview is the first
 * half of sending one, and it exposes the exact wording a customer would
 * receive. Nothing is written and nothing is transmitted.
 */
async function buildPreview(
  bookingId: string,
  event: typeof BOOKING_CONFIRMED | typeof BOOKING_TICKETED,
): Promise<BookingEmailState> {
  try {
    const preview = await previewBookingEmail(bookingId, event);
    return { preview: { event, ...preview } };
  } catch (error) {
    log.error({ err: error, bookingId, event }, "Email preview failed");
    return { error: "The preview could not be built." };
  }
}

/**
 * Previews or re-sends a lifecycle email to the customer.
 *
 * Awaited rather than dispatched in the background: this one is explicit
 * operator intent, so they should be told whether it worked instead of being
 * sent back to the page to guess. It is also the only path that may put a
 * second copy of the same message in a customer's inbox, which is why it needs
 * `message.send` and not merely `booking.view`.
 */
export async function bookingEmailAction(
  _previous: BookingEmailState,
  formData: FormData,
): Promise<BookingEmailState> {
  // The preview exposes the exact wording a customer would receive and is the
  // first half of sending one, so it takes the same permission as sending.
  await requirePermission(PERMISSIONS.MESSAGE_SEND);

  const parsed = resendSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    return { error: "Invalid request." };
  }

  const { bookingId, event, intent, subject, body } = parsed.data;

  // Reading is not sending: nothing is written and nothing is transmitted.
  if (intent === "preview") return buildPreview(bookingId, event);

  // Both halves or neither. Sending a generated body under an edited subject
  // would be a message nobody wrote.
  if ((subject === undefined) !== (body === undefined)) {
    return { error: "An edited email needs both a subject and a message." };
  }

  const override = subject && body ? { subject, body } : undefined;

  try {
    const outcome = await sendBookingEmail({
      bookingId,
      event,
      force: true,
      override,
    });

    revalidatePath(`/admin/bookings/${bookingId}`);

    switch (outcome.result) {
      case "sent":
        return {
          success: override
            ? "Your edited email was sent to the customer."
            : "Email sent to the customer.",
        };
      case "suppressed":
        return { error: outcome.reason };
      case "failed":
        return { error: `The email was not accepted: ${outcome.reason}` };
      case "duplicate":
        // Unreachable with force: true, but the compiler should keep this
        // exhaustive so a new outcome has to be considered here.
        return { success: "Already sent; nothing further was sent." };
    }
  } catch (error) {
    log.error({ err: error, bookingId, event }, "Resend failed");
    return { error: "The email could not be sent. Try again." };
  }
}
