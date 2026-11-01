"use client";

import { ExternalLink, Loader2, Pencil, Send } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button, buttonVariants } from "@/components/ui/button";

import { EmailEditor } from "./email-editor";
import { bookingEmailAction, type BookingEmailState } from "./email-actions";

/**
 * Sends the e-ticket from the preview page.
 *
 * Reuses `bookingEmailAction` rather than adding a second send path: that
 * action is where the permission check, the notification record and the
 * suppressed-transport handling live, and a parallel implementation would
 * drift from it.
 *
 * The plain Send button submits no `subject` or `body`, so the action falls
 * back to the generated message — the document as rendered. Edit asks the same
 * action for a preview and sends whatever the operator leaves on screen.
 *
 * Both carry `intent` as their own name/value rather than sharing a hidden
 * input: only the submitter's name and value are posted, which is exactly the
 * "which one did they click" signal this needs.
 */
function SubmitButton({ blockedReason }: { blockedReason?: string | undefined }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      name="intent"
      value="send"
      variant="destructive"
      // Clickable even while blocked — see `AuthorizationPanel`. The signature
      // rule and the missing-recipient rule are both enforced in
      // `bookingEmailAction`, which answers with the reason.
      disabled={pending}
      title={blockedReason}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Send />}
      {pending ? "Sending…" : "Click here Send E-Ticket Email"}
    </Button>
  );
}

/**
 * Opens the e-ticket email for editing.
 *
 * Deliberately available even while the send is blocked — staff prepare the
 * wording while they wait for the signature — and a preview sends nothing.
 */
function EditButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      name="intent"
      value="preview"
      variant="secondary"
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Pencil className="size-4" />
      )}
      Edit email
    </Button>
  );
}

export function SendETicketButton({
  bookingId,
  recipient,
  blockedReason,
  viewHref,
}: {
  bookingId: string;
  /** Empty when the booking has no contact address; nothing could be sent. */
  recipient: string;
  /**
   * Why the send is unavailable, or `undefined` when it is available.
   *
   * Shown to the operator as well as used to disable the button: a control
   * that is greyed out without saying why reads as a bug. The server applies
   * the same rules in `bookingEmailAction` — this only saves a round trip.
   */
  blockedReason?: string | undefined;
  /**
   * Where to open the document for reading, or `undefined` to offer no link.
   *
   * Left off by the e-ticket page itself, which is already that document —
   * a link from a page back to itself is noise.
   */
  viewHref?: string | undefined;
}) {
  const [state, formAction] = useActionState<BookingEmailState, FormData>(
    bookingEmailAction,
    {},
  );

  /** Dismissed preview, compared by identity — see `CustomerEmailPanel`. */
  const [dismissed, setDismissed] = useState<BookingEmailState["preview"]>();

  const editing =
    state.preview && state.preview !== dismissed ? state.preview : undefined;

  const blocked =
    recipient === ""
      ? "This booking has no contact address to send to."
      : blockedReason;

  return (
    <div>
      <form action={formAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="bookingId" value={bookingId} />
        <input type="hidden" name="event" value="BOOKING_TICKETED" />
        <SubmitButton blockedReason={blocked} />
        <EditButton />

        {/* Deliberately available even while the send is blocked: staff still
            need to check the document while they wait for the signature.
            An anchor cannot submit the form, so reading is never a send.

            Named for what it opens rather than a bare "View", because the
            authorization panel carries two of these side by side and two
            links reading "View" are indistinguishable to a screen reader. */}
        {viewHref ? (
          <a
            href={viewHref}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "secondary" })}
          >
            <ExternalLink className="size-4" />
            View e-ticket
          </a>
        ) : null}
      </form>

      {editing ? (
        <div className="mt-3">
          <EmailEditor
            title="E-ticket email"
            fieldKey={`eticket-${bookingId}`}
            recipient={editing.recipient}
            subject={editing.subject}
            body={editing.body}
            hidden={{
              bookingId,
              event: editing.event,
              intent: "send",
            }}
            {...(blocked
              ? {
                  note: (
                    <p className="rounded-md bg-status-warning-bg px-3 py-2 text-xs text-status-warning">
                      {blocked}
                    </p>
                  ),
                }
              : {})}
            onClose={() => setDismissed(state.preview)}
            formAction={formAction}
          />
        </div>
      ) : null}

      {blocked ? (
        <p className="mt-2 text-xs text-ink-muted">{blocked}</p>
      ) : null}

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
