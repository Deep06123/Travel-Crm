"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/dal";
import { isDatabaseUnavailable, DATABASE_UNAVAILABLE_MESSAGE } from "@/lib/db/errors";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  TicketNotIssuableError,
  issueTicket,
} from "@/server/services/ticketing-service";

const log = loggerFor("ticketing-actions");

export interface TicketingState {
  error?: string;
  success?: string;
}

const issueSchema = z.object({
  bookingId: z.string().trim().min(1),
  ticketingReference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2_000).optional(),
});

/**
 * Field name carrying a passenger's ticket number.
 *
 * One input per passenger, named with the passenger's id, because a booking
 * has as many tickets as it has travellers and each number belongs to exactly
 * one of them.
 */
const TICKET_FIELD = /^ticketNumber\[(.+)\]$/;

export async function issueTicketAction(
  _previous: TicketingState,
  formData: FormData,
): Promise<TicketingState> {
  // Ticketing edits the booking, so it is governed by the same capability.
  // Checked on the server regardless of whether the form was rendered.
  const user = await requirePermission(PERMISSIONS.BOOKING_UPDATE);

  const parsed = issueSchema.safeParse({
    bookingId: formData.get("bookingId"),
    ticketingReference: formData.get("ticketingReference") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });

  if (!parsed.success) {
    return { error: "That ticketing submission was not valid." };
  }

  const ticketNumbers: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    const match = TICKET_FIELD.exec(key);
    if (match?.[1] && typeof value === "string") {
      ticketNumbers[match[1]] = value;
    }
  }

  try {
    const result = await issueTicket({
      bookingId: parsed.data.bookingId,
      actorId: user.id,
      ticketNumbers,
      ticketingReference: parsed.data.ticketingReference,
      notes: parsed.data.notes,
    });

    revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);

    return {
      success: result.changed
        ? "Ticket issued. The booking can now be marked Ticketed."
        : "This ticket was already issued; nothing was changed.",
    };
  } catch (error) {
    // A refusal the operator can act on, shown as written. These are the
    // business rules talking, not a fault.
    if (error instanceof TicketNotIssuableError) {
      return { error: error.message };
    }

    if (isDatabaseUnavailable(error)) {
      log.error({ err: error }, "Issue ticket failed: database unreachable");
      return { error: DATABASE_UNAVAILABLE_MESSAGE };
    }

    log.error({ err: error }, "Issue ticket failed unexpectedly");
    return { error: "The ticket could not be issued. Try again." };
  }
}
