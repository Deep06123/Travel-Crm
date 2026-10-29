"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";

import { deleteBookingAction, type BookingDeleteState } from "./actions";

function SubmitButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="destructive" disabled={pending || blocked}>
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
      {pending ? "Deleting…" : "Delete this booking"}
    </Button>
  );
}

/**
 * Deletes a booking that should never have existed.
 *
 * Distinct from cancelling, and worded so the operator does not reach for it
 * by accident: a cancelled booking stays on the record because it happened,
 * while this erases one that did not. The booking number must be typed back
 * before the button enables.
 *
 * Both guards here are repeated in `deleteBooking` — the typed confirmation
 * and the reason — because this form is a convenience, not the check. The
 * service also refuses outright once the booking has payments, refunds,
 * chargebacks, adjustments, service cases, documents or an issued ticket.
 */
export function DeleteBookingControl({
  bookingId,
  bookingNumber,
}: {
  bookingId: string;
  bookingNumber: string;
}) {
  const [state, formAction] = useActionState<BookingDeleteState, FormData>(
    deleteBookingAction,
    {},
  );
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");

  const confirmed =
    confirmation.trim().toUpperCase() === bookingNumber.toUpperCase();

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="bookingId" value={bookingId} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
        >
          {state.error}
        </p>
      ) : null}

      <p className="text-sm text-ink-muted">
        Deleting removes this booking and its passengers, segments, comments
        and history for good. It cannot be undone. If the booking really
        happened and then fell through, cancel it instead so the record is
        kept.
      </p>

      <Field
        id="deleteReason"
        label="Reason"
        required
        hint="Kept in the audit log, which is all that remains afterwards."
      >
        {(props) => (
          <Textarea
            {...props}
            name="reason"
            rows={2}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Duplicate of MV70051, created in error."
          />
        )}
      </Field>

      <Field
        id="deleteConfirmation"
        label={`Type ${bookingNumber} to confirm`}
      >
        {(props) => (
          <input
            {...props}
            name="confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            className="h-9 w-full rounded-md border border-status-danger bg-white px-3 text-sm"
          />
        )}
      </Field>

      <div>
        <SubmitButton blocked={!confirmed || reason.trim().length < 5} />
      </div>
    </form>
  );
}
