"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import type { BookingStatus } from "@/generated/prisma/enums";

import { changeBookingStatusAction, type StatusChangeState } from "./actions";

/** Statuses whose transition must carry a written reason. */
const REASON_REQUIRED: readonly string[] = ["CANCELLED", "NEEDS_REVIEW"];

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function SubmitButton({
  destructive,
  blocked,
}: {
  destructive: boolean;
  /** True while the form's own guards are unsatisfied. */
  blocked: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={destructive ? "destructive" : "primary"}
      disabled={pending || blocked}
    >
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Applying…" : "Apply status change"}
    </Button>
  );
}

/**
 * Status change control.
 *
 * Only transitions the server would accept are offered, and the destructive
 * ones require a typed confirmation before the button is enabled. Both are
 * conveniences — the transition service re-checks the matrix, the evidence and
 * the reason regardless of what this form submits.
 */
export function StatusControl({
  bookingId,
  currentStatus,
  allowedStatuses,
}: {
  bookingId: string;
  currentStatus: BookingStatus;
  allowedStatuses: readonly BookingStatus[];
}) {
  const [state, formAction] = useActionState<StatusChangeState, FormData>(
    changeBookingStatusAction,
    {},
  );
  const [selected, setSelected] = useState<string>("");
  const [confirmation, setConfirmation] = useState("");

  if (allowedStatuses.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        {humanise(currentStatus)} is a final status. This booking cannot move
        further.
      </p>
    );
  }

  const isCancelling = selected === "CANCELLED";
  const needsReason = REASON_REQUIRED.includes(selected);
  const confirmed = !isCancelling || confirmation.trim().toUpperCase() === "CANCEL";

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

      {state.success ? (
        <p
          role="status"
          className="rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success"
        >
          {state.success}
        </p>
      ) : null}

      <Field id="toStatus" label="Move to">
        {(props) => (
          <Select
            {...props}
            name="toStatus"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">— Select a status —</option>
            {allowedStatuses.map((status) => (
              <option key={status} value={status}>
                {humanise(status)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {needsReason ? (
        <Field
          id="reason"
          label="Reason"
          required
          hint="Recorded against the booking's status history."
        >
          {(props) => <Textarea {...props} name="reason" rows={2} required />}
        </Field>
      ) : null}

      {isCancelling ? (
        <Field
          id="cancelConfirmation"
          label="Type CANCEL to confirm"
          hint="Cancellation is final — a cancelled booking cannot be reinstated."
        >
          {(props) => (
            <input
              {...props}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="h-9 w-full rounded-md border border-status-danger bg-white px-3 text-sm"
            />
          )}
        </Field>
      ) : null}

      <div>
        <SubmitButton
          destructive={isCancelling}
          blocked={selected === "" || !confirmed}
        />
      </div>
    </form>
  );
}
