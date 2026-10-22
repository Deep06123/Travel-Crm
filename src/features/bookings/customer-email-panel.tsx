"use client";

import { Loader2, Send } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import type {
  NotificationStatus as NotificationStatusEnum,
} from "@/generated/prisma/enums";
import { resendBookingEmailAction, type ResendEmailState } from "./email-actions";

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
function ResendButton({
  event,
  children,
}: {
  event: string;
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
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Send className="size-4" />
      )}
      {children}
    </Button>
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
  const [state, formAction] = useActionState<ResendEmailState, FormData>(
    resendBookingEmailAction,
    {},
  );

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

      {canResend && availableEvents.length > 0 ? (
        <form action={formAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="bookingId" value={bookingId} />
          {availableEvents.map((event) => (
            <ResendButton key={event} event={event}>
              Resend {label(event).toLowerCase()}
            </ResendButton>
          ))}
        </form>
      ) : null}
    </div>
  );
}
