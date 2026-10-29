"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";

import { deleteBookingAction, type BookingDeleteState } from "./actions";

function SubmitButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="destructive" disabled={pending || blocked}>
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
      {pending ? "Deleting…" : "Delete booking"}
    </Button>
  );
}

/**
 * Row-level delete, as a dialog rather than a single click.
 *
 * Every other action in this column is a link to a page that only reads, for
 * a good reason: a list row carries almost no context, and an icon that
 * mutates a booking from one is how an audit trail fills with changes nobody
 * can account for. This is the exception, and it earns it by asking for the
 * same two things the booking page does — a reason, and the booking number
 * typed back — before the button will do anything.
 *
 * Both are re-checked in `deleteBooking`, along with the refusals for a
 * booking that has payments, documents or an issued ticket against it. Nothing
 * here is the control; it is the prompt.
 */
export function DeleteBookingButton({
  bookingId,
  bookingNumber,
}: {
  bookingId: string;
  bookingNumber: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState<BookingDeleteState, FormData>(
    deleteBookingAction,
    {},
  );
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");

  // A refusal comes back with the dialog already closed by the form
  // submission, and an error nobody sees is the same as no error. Reopen on it.
  useEffect(() => {
    if (state.error && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, [state.error]);

  const confirmed =
    confirmation.trim().toUpperCase() === bookingNumber.toUpperCase();

  function close() {
    setConfirmation("");
    setReason("");
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        title="Delete this booking"
        className="flex size-7 items-center justify-center rounded text-ink-muted hover:bg-status-danger-bg hover:text-status-danger [&_svg]:size-4"
      >
        <Trash2 />
        <span className="sr-only">Delete booking {bookingNumber}</span>
      </button>

      <dialog
        ref={dialogRef}
        onClose={close}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
      >
        <form action={formAction} className="flex flex-col gap-3 p-5">
          <input type="hidden" name="bookingId" value={bookingId} />

          <h2 className="text-base font-semibold text-ink">
            Delete {bookingNumber}
          </h2>

          {state.error ? (
            <p
              role="alert"
              className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
            >
              {state.error}
            </p>
          ) : null}

          <p className="text-sm text-ink-muted">
            This removes the booking and its passengers, segments, comments and
            history for good. It cannot be undone. If the booking really
            happened and then fell through, cancel it instead so the record is
            kept.
          </p>

          <Field
            id={`deleteReason-${bookingId}`}
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
                placeholder="Duplicate, created in error."
              />
            )}
          </Field>

          <Field
            id={`deleteConfirmation-${bookingId}`}
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

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <SubmitButton blocked={!confirmed || reason.trim().length < 5} />
          </div>
        </form>
      </dialog>
    </>
  );
}
