"use client";

import { ExternalLink, Loader2, Pencil, Send } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button, buttonVariants } from "@/components/ui/button";

import { EmailEditor } from "./email-editor";
import { SenderSelect, type SenderOption } from "./sender-select";
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
function SubmitButton({
  blockedReason,
  pending,
  formId,
}: {
  blockedReason?: string | undefined;
  pending: boolean;
  /**
   * The open editor's form, which this button submits instead of its own.
   *
   * Without it, clicking Send with the editor open sent the generated message
   * and threw away what the operator had typed — the same defect the
   * authorization panel had, and the same fix. `intent` comes off the button
   * in that case because the editor posts its own, and a submitter outside the
   * form would otherwise contribute a second one.
   */
  formId?: string | undefined;
}) {
  return (
    <Button
      type="submit"
      {...(formId ? { form: formId } : { name: "intent", value: "send" })}
      variant="destructive"
      // Clickable even while blocked — see `AuthorizationPanel`. The signature
      // rule and the missing-recipient rule are both enforced in
      // `bookingEmailAction`, which answers with the reason.
      disabled={pending}
      title={blockedReason}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Send />}
      {pending
        ? "Sending…"
        : formId
          ? // Not the editor's own "Send this version": one name per button,
            // see `AuthorizationPanel`.
            "Send the edited version"
          : "Click here Send E-Ticket Email"}
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
  senders = [],
  canManageSettings = false,
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
  /** Active sending accounts. Empty: no picker, only a pointer to Settings. */
  senders?: readonly SenderOption[];
  /** Whether this user could act on "no accounts configured". */
  canManageSettings?: boolean;
}) {
  const [state, formAction, isPending] = useActionState<
    BookingEmailState,
    FormData
  >(bookingEmailAction, {});

  /** Dismissed preview, compared by identity — see `CustomerEmailPanel`. */
  const [dismissed, setDismissed] = useState<BookingEmailState["preview"]>();

  // Held here, not in either form: the editor below is a second form and must
  // send from whatever was picked before Edit was clicked.
  const [senderId, setSenderId] = useState("");

  const editing =
    state.preview && state.preview !== dismissed ? state.preview : undefined;

  /** The open editor's form — see `SubmitButton`. */
  const editorFormId = editing ? `eticket-editor-${bookingId}` : undefined;

  const blocked =
    recipient === ""
      ? "This booking has no contact address to send to."
      : blockedReason;

  return (
    <div>
      <form action={formAction} className="flex flex-col items-start gap-2">
        <input type="hidden" name="bookingId" value={bookingId} />
        <input type="hidden" name="event" value="BOOKING_TICKETED" />

        {/* Inside the form, so it posts itself rather than through a mirror
            input. The editor below is a second form and reads the same state
            from `hidden`. */}
        <SenderSelect
          id={`eticket-sender-${bookingId}`}
          options={senders}
          value={senderId}
          onChange={setSenderId}
          canManageSettings={canManageSettings}
        />

        <div className="flex flex-wrap gap-2">
          <SubmitButton
            blockedReason={blocked}
            pending={isPending}
            {...(editorFormId ? { formId: editorFormId } : {})}
          />
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
        </div>
      </form>

      {editing ? (
        <div className="mt-3">
          <EmailEditor
            title="E-ticket email"
            fieldKey={`eticket-${bookingId}`}
            {...(editorFormId ? { formId: editorFormId } : {})}
            recipient={editing.recipient}
            subject={editing.subject}
            body={editing.body}
            generatedBody={editing.generatedBody}
            bodyHint="Plain text. Leave a blank line between paragraphs. It is remembered for this booking: the preview and the next send both use it."
            hidden={{
              bookingId,
              event: editing.event,
              intent: "send",
              ...(senderId ? { mailAccountId: senderId } : {}),
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
