"use client";

import { Loader2, Send } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

import { bookingEmailAction, type BookingEmailState } from "./email-actions";

/**
 * Sends the e-ticket from the preview page.
 *
 * Reuses `bookingEmailAction` rather than adding a second send path: that
 * action is where the permission check, the notification record and the
 * suppressed-transport handling live, and a parallel implementation would
 * drift from it.
 *
 * `subject` and `body` are deliberately not submitted. The action falls back
 * to the generated message when they are absent, which is what this page is
 * for — sending the document as rendered, not an edited version of it.
 */
function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="destructive"
      disabled={pending || disabled}
      title={
        disabled ? "This booking has no contact address to send to." : undefined
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Send />}
      {pending ? "Sending…" : "Click here Send E-Ticket Email"}
    </Button>
  );
}

export function SendETicketButton({
  bookingId,
  recipient,
}: {
  bookingId: string;
  /** Empty when the booking has no contact address; nothing could be sent. */
  recipient: string;
}) {
  const [state, formAction] = useActionState<BookingEmailState, FormData>(
    bookingEmailAction,
    {},
  );

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <input type="hidden" name="event" value="BOOKING_TICKETED" />
        <input type="hidden" name="intent" value="send" />
        <SubmitButton disabled={recipient === ""} />
      </form>

      {state.error ? (
        <p
          role="alert"
          className="mt-2 rounded-md bg-status-danger-bg px-3 py-2 text-xs text-status-danger"
        >
          {state.error}
        </p>
      ) : null}

      {state.success ? (
        <p
          role="status"
          className="mt-2 rounded-md bg-status-success-bg px-3 py-2 text-xs text-status-success"
        >
          {state.success}
        </p>
      ) : null}
    </div>
  );
}
