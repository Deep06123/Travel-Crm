"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { McoStatus } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/dal";
import {
  InvalidMcoTransitionError,
  McoNotUpdatableError,
  McoReasonRequiredError,
} from "@/lib/bookings/mco";
import {
  DATABASE_UNAVAILABLE_MESSAGE,
  isDatabaseUnavailable,
} from "@/lib/db/errors";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { updateMco } from "@/server/services/mco-service";

const log = loggerFor("mco-actions");

export interface McoState {
  error?: string;
  success?: string;
}

const mcoSchema = z.object({
  bookingId: z.string().trim().min(1),
  // The form always submits both selects. An empty supplier means "none", an
  // empty status means "leave it where it is" — which is why they are
  // normalised differently below.
  mcoSupplierId: z.string().trim().max(40),
  toStatus: z.union([z.enum(McoStatus), z.literal("")]),
  reason: z.string().trim().max(1_000).optional(),
});

export async function updateMcoAction(
  _previous: McoState,
  formData: FormData,
): Promise<McoState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_MCO_UPDATE);

  const parsed = mcoSchema.safeParse({
    bookingId: formData.get("bookingId"),
    mcoSupplierId: formData.get("mcoSupplierId") ?? "",
    toStatus: formData.get("toStatus") ?? "",
    reason: formData.get("reason") ?? undefined,
  });

  if (!parsed.success) {
    return { error: "That MCO submission was not valid." };
  }

  try {
    const result = await updateMco({
      bookingId: parsed.data.bookingId,
      actorId: user.id,
      mcoSupplierId: parsed.data.mcoSupplierId || null,
      ...(parsed.data.toStatus ? { toStatus: parsed.data.toStatus } : {}),
      reason: parsed.data.reason,
    });

    revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
    // The list renders the MCO badge too, so it would otherwise keep showing
    // the old value until its own cache expired.
    revalidatePath("/admin/bookings");

    if (!result.statusChanged && !result.supplierChanged) {
      return { success: "Nothing to change — the MCO is already as submitted." };
    }

    const parts = [
      result.statusChanged
        ? `moved from ${result.fromStatus} to ${result.toStatus}`
        : null,
      result.supplierChanged ? "supplier updated" : null,
    ].filter(Boolean);

    return { success: `MCO ${parts.join(", ")}.` };
  } catch (error) {
    // Refusals the operator can act on, shown as written. These are the
    // business rules talking, not a fault.
    if (
      error instanceof InvalidMcoTransitionError ||
      error instanceof McoReasonRequiredError ||
      error instanceof McoNotUpdatableError
    ) {
      return { error: error.message };
    }

    if (isDatabaseUnavailable(error)) {
      log.error({ err: error }, "MCO update failed: database unreachable");
      return { error: DATABASE_UNAVAILABLE_MESSAGE };
    }

    log.error(
      { err: error, bookingId: parsed.data.bookingId },
      "MCO update failed unexpectedly",
    );
    return { error: "The MCO could not be updated. Try again." };
  }
}
