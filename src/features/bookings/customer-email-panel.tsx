"use client";

import { ExternalLink, Eye, Loader2, Send, X } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import type {
  NotificationStatus as NotificationStatusEnum,
} from "@/generated/prisma/enums";
import { bookingEmailAction, type BookingEmailState } from "./email-actions";

/**
 * What the customer has actually been emailed about this booking.
 *
 * Deliberately shows failures and suppressions as prominently as successes. An
 * operator who cannot see that a confirmation never left will assume it did,
 * and the customer finds out at the airport.
 */

export interface CustomerEmailRow {
  id: string;
  eventType: string;
  status: NotificationStatusEnum;
  recipient: string;
  /**
   * Pre-formatted on the server. `@/lib/format` reaches `@/lib/env`, which is
   * `server-only` — importing it here would pull server configuration into
   * the browser bundle and fail the build.
   */
  sentAtLabel: string | null;
  attemptCount: number;
  lastError: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  BOOKING_CONFIRMED: "Booking confirmation",
  BOOKING_TICKETED: "Tickets issued",
};

const STATUS_STYLES: Record<string, string> = {
  SENT: "bg-status-success-bg text-status-success",
  DELIVERED: "bg-status-success-bg text-status-success",
  FAILED: "bg-status-danger-bg text-status-danger",
  SUPPRESSED: "bg-status-warning-bg text-status-warning",
  PENDING: "bg-surface-sunken text-ink-muted",
};

function label(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

/**
 * One button per event, carrying the event as its own name/value.
 *
 * A hidden input would not work here: every hidden input in a form is
 * submitted, so two of them named `event` would send both values and the
 * action would act on whichever won. Only the *submitter* button's name and
 * value are included, which is exactly the "which one did they click" signal
 * this needs.
 */
function EventButton({
  event,
  icon,
  children,
}: {
  event: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      name="event"
      value={event}
      variant="secondary"
      size="sm"
      disabled={pending}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </Button>
  );
}

/**
 * The email as it would be sent, open for correction.
 *
 * Shown only after the operator asks for a preview, and pre-filled with the
 * generated wording. Sending from here sends exactly what is on screen — the
 * point of the control is that what you read is what the customer gets.
 *
 * The body is plain text. A rich editor would imply the operator can control
 * the layout, which they cannot: the surrounding markup is supplied by the
 * server precisely so an edited email cannot arrive malformed.
 */
function EmailEditor({
  bookingId,
  preview,
  onClose,
  formAction,
}: {
  bookingId: string;
  preview: NonNullable<BookingEmailState["preview"]>;
  onClose: () => void;
  formAction: (payload: FormData) => void;
}) {
  const { pending } = useFormStatus();

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-md border border-line bg-surface-muted p-3"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="event" value={preview.event} />
      <input type="hidden" name="intent" value="send" />

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">
          Preview — {label(preview.event).toLowerCase()}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="size-4" />
          Close
        </Button>
      </div>

      <p className="text-xs text-ink-muted">
        To: {preview.recipient || "— no contact address on this booking —"}
      </p>

      {/* Keyed on the event so switching between the confirmation and the
          ticket preview resets the fields instead of keeping the old text. */}
      <Field id={`email-subject-${preview.event}`} label="Subject" required>
        {(props) => (
          <Input
            {...props}
            name="subject"
            required
            maxLength={200}
            defaultValue={preview.subject}
          />
        )}
      </Field>

      <Field
        id={`email-body-${preview.event}`}
        label="Message"
        required
        hint="Plain text. Leave a blank line between paragraphs."
      >
        {(props) => (
          <Textarea
            {...props}
            name="body"
            rows={14}
            required
            className="font-mono text-xs"
            defaultValue={preview.body}
          />
        )}
      </Field>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !preview.recipient}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Send this version
        </Button>

        {preview.recipient ? null : (
          <span className="text-xs text-status-warning">
            Add a contact email to the booking before sending.
          </span>
        )}
      </div>
    </form>
  );
}

export function CustomerEmailPanel({
  bookingId,
  rows,
  canResend,
  availableEvents,
}: {
  bookingId: string;
  rows: readonly CustomerEmailRow[];
  canResend: boolean;
  /** Events this booking has reached, so only meaningful resends are offered. */
  availableEvents: readonly string[];
}) {
  const [state, formAction] = useActionState<BookingEmailState, FormData>(
    bookingEmailAction,
    {},
  );

  /**
   * The preview the operator has dismissed, if any.
   *
   * Compared by identity against the current result, so a fresh preview of the
   * same event reopens the editor rather than being swallowed by an earlier
   * dismissal. Derived rather than mirrored — a successful send returns a
   * result with no `preview`, which closes the editor on its own.
   */
  const [dismissed, setDismissed] = useState<BookingEmailState["preview"]>();

  const editing =
    state.preview && state.preview !== dismissed ? state.preview : undefined;

  return (
    <div className="flex flex-col gap-3">
      {state.error ? (
        <p
          role="alert"
          className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
        >
          {state.error}
        </p>
      ) : null}

      {state.success ? (
        <p
          role="status"
          className="rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success"
        >
          {state.success}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No customer email has been raised for this booking yet. One is sent
          automatically when the booking is confirmed and when it is ticketed.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-md border border-line px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">
                  {label(row.eventType)}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                    STATUS_STYLES[row.status] ?? "bg-surface-sunken text-ink-muted"
                  }`}
                >
                  {row.status}
                </span>
                {row.attemptCount > 1 ? (
                  <span className="text-xs text-ink-subtle">
                    {row.attemptCount} attempts
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-ink-muted">
                {row.recipient || "no recipient address"}
                {row.sentAtLabel ? ` · sent ${row.sentAtLabel}` : null}
              </p>

              {row.lastError ? (
                <p className="mt-1 text-xs text-status-danger">{row.lastError}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canResend && editing ? (
        <EmailEditor
          bookingId={bookingId}
          preview={editing}
          onClose={() => setDismissed(state.preview)}
          formAction={formAction}
        />
      ) : null}

      {/* Opens the document itself, rendered by the same code that builds the
          email body — so what is checked here is what the customer receives.
          A new tab rather than a dialog: it is a full page, and the operator
          usually wants the booking still open beside it. */}
      <a
        href={`/admin/bookings/${bookingId}/eticket`}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: "secondary", size: "sm" })}
      >
        <ExternalLink className="size-4" />
        Open e-ticket
      </a>

      {canResend && availableEvents.length > 0 ? (
        <div className="flex flex-col gap-2">
          {/* Preview and send are separate forms. They post different fields
              to different actions, and nesting forms is invalid HTML. */}
          <form action={formAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="bookingId" value={bookingId} />
            <input type="hidden" name="intent" value="preview" />
            {availableEvents.map((event) => (
              <EventButton
                key={event}
                event={event}
                icon={<Eye className="size-4" />}
              >
                Preview {label(event).toLowerCase()}
              </EventButton>
            ))}
          </form>

          <form action={formAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="bookingId" value={bookingId} />
            <input type="hidden" name="intent" value="send" />
            {availableEvents.map((event) => (
              <EventButton
                key={event}
                event={event}
                icon={<Send className="size-4" />}
              >
                Resend {label(event).toLowerCase()}
              </EventButton>
            ))}
          </form>
        </div>
      ) : null}
    </div>
  );
}
