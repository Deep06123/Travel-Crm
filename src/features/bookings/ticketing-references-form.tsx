"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

import {
  updateTicketingDetailsAction,
  type TicketingDetailsState,
} from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Saving…" : "Save references"}
    </Button>
  );
}

/**
 * The references a ticket is issued against.
 *
 * `issueTicket` refuses until the booking carries an airline confirmation, and
 * that field could only be set on the create form — but the confirmation comes
 * back from the airline *after* the booking is taken, so in practice it was
 * never available at the only moment it could be entered. The panel told the
 * operator to "record the airline or supplier confirmation reference" and gave
 * them nowhere to record it.
 *
 * The supplier reference is here too. The issue-ticket form below also carries
 * one, but it is only written on a *successful* issue — which the missing
 * confirmation prevented — so before issuing, that field was unreachable as
 * well.
 */
export function TicketingReferencesForm({
  bookingId,
  airlineConfirmation,
  ticketingReference,
}: {
  bookingId: string;
  airlineConfirmation: string | null;
  ticketingReference: string | null;
}) {
  const [state, formAction] = useActionState<TicketingDetailsState, FormData>(
    updateTicketingDetailsAction,
    {},
  );

  return (
    <form action={formAction} className="mt-4 border-t border-line pt-4">
      <input type="hidden" name="bookingId" value={bookingId} />

      {state.error ? (
        <p
          role="alert"
          className="mb-3 rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
        >
          {state.error}
        </p>
      ) : null}

      {state.success ? (
        <p
          role="status"
          className="mb-3 rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success"
        >
          {state.success}
        </p>
      ) : null}

      <p className="mb-3 text-xs font-semibold tracking-wider text-ink-muted uppercase">
        Record references
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="airlineConfirmation"
          label="Airline confirmation"
          hint="Required before a ticket can be issued."
        >
          {(controlProps) => (
            <Input
              {...controlProps}
              name="airlineConfirmation"
              defaultValue={airlineConfirmation ?? ""}
              placeholder="ABC123"
              autoComplete="off"
            />
          )}
        </Field>

        <Field
          id="supplierReference"
          label="Supplier reference"
          hint="The supplier's own reference, if there is one."
        >
          {(controlProps) => (
            <Input
              {...controlProps}
              name="ticketingReference"
              defaultValue={ticketingReference ?? ""}
              autoComplete="off"
            />
          )}
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <SubmitButton />
        <p className="text-xs text-ink-subtle">
          Saved against the booking and written to the audit log.
        </p>
      </div>
    </form>
  );
}
