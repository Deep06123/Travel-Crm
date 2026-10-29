"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

import {
  updateBookingFinancialsAction,
  type BookingFinancialsState,
} from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Saving…" : "Save amounts"}
    </Button>
  );
}

export interface BookingAmounts {
  /** Decimal strings in the booking's own currency, e.g. "1029.97". */
  baseFare: string;
  taxesFees: string;
  total: string;
  supplierCost: string;
  grossMco: string;
  netMco: string;
}

/**
 * Corrects a booking's money after it was created.
 *
 * These are set on the create form and were unreachable afterwards, which left
 * an MCO that could never be submitted — the panel reports "no gross MCO
 * amount, so there is nothing to submit" and there was no way to supply one —
 * and no way to fix a figure typed wrongly short of deleting the booking.
 *
 * Every field is sent on every save, including the ones left untouched, so the
 * action compares a complete picture; the service writes nothing and logs
 * nothing when no value actually moved.
 */
export function BookingFinancialsForm({
  bookingId,
  currency,
  amounts,
}: {
  bookingId: string;
  currency: string;
  amounts: BookingAmounts;
}) {
  const [state, formAction] = useActionState<BookingFinancialsState, FormData>(
    updateBookingFinancialsAction,
    {},
  );

  const error = (field: string) => state.fieldErrors?.[field];

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
        Edit amounts ({currency})
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* "Base fare", matching the detail row directly above it. The create
            form calls the same field "Gross fare"; side by side in one panel,
            agreeing with the value being edited matters more. */}
        <Field id="edit-baseFare" label="Base fare" error={error("baseFare")}>
          {(props) => (
            <Input
              {...props}
              name="baseFare"
              inputMode="decimal"
              defaultValue={amounts.baseFare}
            />
          )}
        </Field>

        <Field
          id="edit-taxesFees"
          label="Taxes and fees"
          error={error("taxesFees")}
        >
          {(props) => (
            <Input
              {...props}
              name="taxesFees"
              inputMode="decimal"
              defaultValue={amounts.taxesFees}
            />
          )}
        </Field>

        <Field
          id="edit-total"
          label="Gross booking value"
          hint="What the customer is charged."
          error={error("total")}
        >
          {(props) => (
            <Input
              {...props}
              name="total"
              inputMode="decimal"
              defaultValue={amounts.total}
            />
          )}
        </Field>

        <Field
          id="edit-supplierCost"
          label="Supplier cost"
          error={error("supplierCost")}
        >
          {(props) => (
            <Input
              {...props}
              name="supplierCost"
              inputMode="decimal"
              defaultValue={amounts.supplierCost}
            />
          )}
        </Field>

        <Field
          id="edit-grossMco"
          label="Gross MCO"
          hint="Needed before the MCO can be submitted."
          error={error("grossMco")}
        >
          {(props) => (
            <Input
              {...props}
              name="grossMco"
              inputMode="decimal"
              defaultValue={amounts.grossMco}
            />
          )}
        </Field>

        <Field id="edit-netMco" label="Net MCO" error={error("netMco")}>
          {(props) => (
            <Input
              {...props}
              name="netMco"
              inputMode="decimal"
              defaultValue={amounts.netMco}
            />
          )}
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <SubmitButton />
        <p className="text-xs text-ink-subtle">
          Changing the gross booking value moves the outstanding balance, which
          is what gates issuing a ticket. Every change is written to the audit
          log.
        </p>
      </div>
    </form>
  );
}
