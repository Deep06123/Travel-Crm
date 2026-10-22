"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/dal";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  BOOKING_CONFIRMED,
  BOOKING_TICKETED,
  sendBookingEmail,
} from "@/server/services/customer-email-service";

const log = loggerFor("booking-email-actions");

const resendSchema = z.object({
  bookingId: z.string().min(1),
  event: z.enum([BOOKING_CONFIRMED, BOOKING_TICKETED]),
});

export interface ResendEmailState {
  error?: string;
  success?: string;
}

/**
 * Re-sends a lifecycle email to the customer.
 *
 * Awaited rather than dispatched in the background: this one is explicit
 * operator intent, so they should be told whether it worked instead of being
 * sent back to the page to guess. It is also the only path that may put a
 * second copy of the same message in a customer's inbox, which is why it needs
 * `message.send` and not merely `booking.view`.
 */
export async function resendBookingEmailAction(
  _previous: ResendEmailState,
  formData: FormData,
): Promise<ResendEmailState> {
  await requirePermission(PERMISSIONS.MESSAGE_SEND);

  const parsed = resendSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    return { error: "Invalid request." };
  }

  const { bookingId, event } = parsed.data;

  try {
    const outcome = await sendBookingEmail({ bookingId, event, force: true });

    revalidatePath(`/admin/bookings/${bookingId}`);

    switch (outcome.result) {
      case "sent":
        return { success: "Email sent to the customer." };
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
