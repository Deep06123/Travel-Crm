import "server-only";

import { AuditAction, McoStatus } from "@/generated/prisma/enums";
import { recordAudit, type FieldChange } from "@/lib/audit";
import {
  InvalidMcoTransitionError,
  McoNotUpdatableError,
  McoReasonRequiredError,
  isMcoTransitionAllowed,
  mcoReasonRequired,
  mcoSupplierIsSettled,
} from "@/lib/bookings/mco";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";

const log = loggerFor("mco");

/**
 * The single place a booking's MCO may change after creation.
 *
 * Nothing else writes `Booking.mcoStatus` or `Booking.mcoSupplierId` once the
 * booking form has set their opening values, for the same reason the status
 * and ticketing services own their fields: the matrix and the evidence rules
 * below are only worth having if they cannot be sidestepped by a new route or
 * form.
 *
 * Supplier and status move through one entry point rather than two because
 * they are one decision: submitting an MCO requires a supplier, so splitting
 * them would force an operator to save the supplier and then re-submit the
 * form to move the status, with a half-updated booking in between.
 */

export interface UpdateMcoInput {
  bookingId: string;
  actorId: string;
  /**
   * Omitted leaves the supplier alone; `null` clears it. Anything else is an
   * McoSupplier id.
   */
  mcoSupplierId?: string | null | undefined;
  /** Omitted leaves the status alone. */
  toStatus?: McoStatus | undefined;
  reason?: string | undefined;
}

export interface UpdateMcoResult {
  bookingId: string;
  fromStatus: McoStatus;
  toStatus: McoStatus;
  statusChanged: boolean;
  supplierChanged: boolean;
}

export async function updateMco({
  bookingId,
  actorId,
  mcoSupplierId,
  toStatus,
  reason,
}: UpdateMcoInput): Promise<UpdateMcoResult> {
  const trimmedReason = reason?.trim() || undefined;

  if (toStatus && mcoReasonRequired(toStatus) && !trimmedReason) {
    throw new McoReasonRequiredError(toStatus);
  }

  return prisma.$transaction(async (tx) => {
    // Read inside the transaction so a concurrent update cannot slip between
    // the checks and the write.
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        mcoStatus: true,
        mcoSupplierId: true,
        grossMcoMinor: true,
      },
    });

    if (!booking) {
      throw new Error(`Booking ${bookingId} does not exist.`);
    }

    const fromStatus = booking.mcoStatus;

    // --- Supplier ----------------------------------------------------------

    const nextSupplierId =
      mcoSupplierId === undefined ? booking.mcoSupplierId : mcoSupplierId;
    const supplierChanged = nextSupplierId !== booking.mcoSupplierId;

    if (supplierChanged) {
      // Judged on the status the booking is in now, not the one it is moving
      // to: naming the supplier and submitting to them in the same step is the
      // ordinary case, but re-pointing an MCO the supplier has already seen
      // would rewrite who was asked for what.
      if (mcoSupplierIsSettled(fromStatus)) {
        throw new McoNotUpdatableError(
          "This MCO has already gone to its supplier. Changing who it was sent to would contradict the record; withdraw it or raise a new one instead.",
        );
      }

      if (nextSupplierId) {
        const supplier = await tx.mcoSupplier.findUnique({
          where: { id: nextSupplierId },
          select: { id: true, isActive: true },
        });

        if (!supplier) {
          throw new McoNotUpdatableError("That MCO supplier does not exist.");
        }

        // An existing assignment to a since-retired supplier is left alone —
        // only a new one is refused, so deactivating a supplier does not
        // invalidate the bookings already settled against it.
        if (!supplier.isActive) {
          throw new McoNotUpdatableError(
            "That MCO supplier is no longer active. Pick an active one.",
          );
        }
      }
    }

    // --- Status ------------------------------------------------------------

    // Re-submitting the same status is a no-op rather than an error, so a
    // double-clicked button does not produce a spurious audit entry.
    const statusChanged = toStatus !== undefined && toStatus !== fromStatus;
    const nextStatus = statusChanged && toStatus ? toStatus : fromStatus;

    if (statusChanged) {
      if (!isMcoTransitionAllowed(fromStatus, nextStatus)) {
        throw new InvalidMcoTransitionError(fromStatus, nextStatus);
      }

      // Evidence for submission. An MCO is a claim against a named supplier
      // for a stated amount; sending one with neither is not a claim at all,
      // and would leave the supplier report with a row it cannot attribute.
      // Checked against `nextSupplierId`, so a supplier named in this same
      // submission satisfies it.
      if (nextStatus === McoStatus.SUBMITTED) {
        if (!nextSupplierId) {
          throw new McoNotUpdatableError(
            "Set the MCO supplier before submitting the MCO.",
          );
        }

        if (booking.grossMcoMinor <= 0) {
          throw new McoNotUpdatableError(
            "This booking has no gross MCO amount, so there is nothing to submit.",
          );
        }
      }
    }

    if (!statusChanged && !supplierChanged) {
      return {
        bookingId,
        fromStatus,
        toStatus: fromStatus,
        statusChanged: false,
        supplierChanged: false,
      };
    }

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        ...(statusChanged ? { mcoStatus: nextStatus } : {}),
        ...(supplierChanged ? { mcoSupplierId: nextSupplierId } : {}),
      },
    });

    const changes: Record<string, FieldChange> = {};
    if (statusChanged) {
      changes["mcoStatus"] = { before: fromStatus, after: nextStatus };
    }
    if (supplierChanged) {
      changes["mcoSupplierId"] = {
        before: booking.mcoSupplierId,
        after: nextSupplierId,
      };
    }

    const summary = [
      statusChanged ? `MCO status ${fromStatus} → ${nextStatus}` : null,
      supplierChanged ? "MCO supplier changed" : null,
    ]
      .filter(Boolean)
      .join("; ");

    // Passing `tx` ties the entry to this transaction: if the write rolls
    // back, the entry goes with it rather than claiming a settlement step that
    // never happened. The reason goes in the summary because there is no MCO
    // history table — the audit log is the trail.
    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Booking",
        entityId: bookingId,
        adminUserId: actorId,
        summary: trimmedReason ? `${summary}: ${trimmedReason}` : summary,
        changes,
      },
      tx,
    );

    log.info(
      { bookingId, actorId, fromStatus, nextStatus, supplierChanged },
      "MCO updated",
    );

    return {
      bookingId,
      fromStatus,
      toStatus: nextStatus,
      statusChanged,
      supplierChanged,
    };
  });
}
