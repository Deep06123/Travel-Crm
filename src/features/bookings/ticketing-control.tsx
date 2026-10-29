"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

import { issueTicketAction, type TicketingState } from "./ticketing-actions";

export interface TicketablePassenger {
  id: string;
  fullName: string;
  /** Already-issued number, shown so an operator does not retype it. */
  ticketNumber: string | null;
}

function SubmitButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || blocked}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Issuing…" : "Issue ticket"}
    </Button>
  );
}

/**
 * Issue-ticket control.
 *
 * Collects a number per passenger, because that is what an airline actually
 * issues: one document per traveller, not one per booking.
 *
 * Every rule this form appears to enforce is enforced again in
 * `issueTicket` — the confirmation reference, the product being a flight, the
 * booking not being cancelled, the balance being settled, and the numbers
 * belonging to this booking's own passengers. What is rendered here is a
 * convenience for the operator, never the check itself.
 */
export function TicketingControl({
  bookingId,
  passengers,
  outstandingLabel,
}: {
  bookingId: string;
  passengers: readonly TicketablePassenger[];
  /**
   * Formatted amount still owed, or null when the booking is settled.
   *
   * Only a prompt: `issueTicket` recomputes the balance and refuses on its own
   * reading, so a stale render cannot let an unpaid ticket through.
   */
  outstandingLabel: string | null;
}) {
  const [state, formAction] = useActionState<TicketingState, FormData>(
    issueTicketAction,
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
        Issue ticket
      </p>

      {outstandingLabel ? (
        <p
          role="status"
          className="mb-3 rounded-md bg-status-warning-bg px-3 py-2 text-sm text-status-warning"
        >
          {outstandingLabel} is still outstanding on this booking. Record the
          payment in the Payments panel before a ticket can be issued.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {passengers.map((passenger) => (
          <Field
            key={passenger.id}
            id={`ticketNumber-${passenger.id}`}
            label={passenger.fullName}
          >
            {(controlProps) => (
              <Input
                {...controlProps}
                name={`ticketNumber[${passenger.id}]`}
                defaultValue={passenger.ticketNumber ?? ""}
                placeholder="176-2451889301"
                autoComplete="off"
              />
            )}
          </Field>
        ))}
      </div>

      {/* No supplier reference here. It is captured by the references form
          above, which can be saved on its own — this one only reached the
          booking on a *successful* issue, so the two side by side invited
          typing it into the field that would not keep it. The action still
          accepts the value, so a caller that sends one is unaffected. */}
      <div className="mt-3">
        <Field id="ticketingNotes" label="Ticketing notes">
          {(controlProps) => <Textarea {...controlProps} name="notes" rows={2} />}
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <SubmitButton blocked={outstandingLabel !== null} />
        <p className="text-xs text-ink-subtle">
          Marks the ticket issued and stamps the time. The booking can then be
          moved to Ticketed.
        </p>
      </div>
    </form>
  );
}
