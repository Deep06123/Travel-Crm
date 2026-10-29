"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { StickySelect } from "@/components/ui/sticky-select";
import {
  PaymentMethod,
  PaymentStatus,
  RefundKind,
} from "@/generated/prisma/enums";
import { minorToDecimalString } from "@/lib/financial/money";

import {
  recordPaymentAction,
  requestRefundAction,
  type FinanceFormState,
} from "./actions";

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Feedback({ state }: { state: FinanceFormState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger">
        {state.error}
      </p>
    );
  }

  if (state.success) {
    return (
      <p role="status" className="rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success">
        {state.success}
      </p>
    );
  }

  return null;
}

/**
 * Records a payment against a booking.
 *
 * The idempotency key is minted once per mounted form, so a double-click or a
 * retried submission resolves to the same payment rather than creating a
 * second one.
 */
export function RecordPaymentForm({
  bookingId,
  currency,
}: {
  bookingId: string;
  currency: string;
}) {
  const [state, formAction] = useActionState<FinanceFormState, FormData>(
    recordPaymentAction,
    {},
  );
  const idempotencyKey = useId();

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="idempotencyKey" value={`pay-${bookingId}-${idempotencyKey}`} />
      <Feedback state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="pay-amount"
          label={`Amount (${currency})`}
          required
          error={state.fieldErrors?.["amount"]}
        >
          {(props) => (
            <Input {...props} name="amount" inputMode="decimal" placeholder="0.00" required />
          )}
        </Field>

        <Field id="pay-method" label="Method" required>
          {(props) => (
            <StickySelect {...props} name="method" defaultValue={PaymentMethod.CREDIT_CARD}>
              {Object.values(PaymentMethod).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </StickySelect>
          )}
        </Field>

        <Field
          id="pay-status"
          label="Status"
          required
          hint="Only Captured counts as money collected."
        >
          {(props) => (
            <StickySelect {...props} name="status" defaultValue={PaymentStatus.CAPTURED}>
              {Object.values(PaymentStatus).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </StickySelect>
          )}
        </Field>

        <Field
          id="pay-last4"
          label="Card last 4"
          hint="Full card numbers are never stored."
          error={state.fieldErrors?.["cardLast4"]}
        >
          {(props) => <Input {...props} name="cardLast4" maxLength={4} inputMode="numeric" />}
        </Field>

        <Field id="pay-brand" label="Card brand">
          {(props) => <Input {...props} name="cardBrand" placeholder="Visa" />}
        </Field>

        <Field
          id="pay-txn"
          label="Provider transaction id"
          hint="Recording the same id twice is refused."
        >
          {(props) => <Input {...props} name="providerTransactionId" />}
        </Field>
      </div>

      <p className="text-xs text-ink-muted">
        This is recorded as a manual entry. It is not a provider confirmation,
        and the payment list labels it accordingly.
      </p>

      <div>
        <SubmitButton label="Record payment" />
      </div>
    </form>
  );
}

/**
 * Raises a refund or void request against a booking.
 *
 * `refundableMinor` is computed server-side and shown so the operator knows the
 * ceiling before submitting; the service enforces it regardless.
 */
export function RequestRefundForm({
  bookingId,
  currency,
  refundableMinor,
  payments,
}: {
  bookingId: string;
  currency: string;
  refundableMinor: number;
  payments: { id: string; reference: string; amountMinor: number }[];
}) {
  const [state, formAction] = useActionState<FinanceFormState, FormData>(
    requestRefundAction,
    {},
  );
  const idempotencyKey = useId();
  const [kind, setKind] = useState<string>(RefundKind.REFUND);

  if (refundableMinor <= 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nothing is refundable on this booking — no payment has been collected,
        or everything collected has already been returned.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="idempotencyKey" value={`rfd-${bookingId}-${idempotencyKey}`} />
      <Feedback state={state} />

      <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-ink-muted">
        Refundable: <span className="tabular font-medium text-ink">
          {minorToDecimalString(refundableMinor, currency)} {currency}
        </span>{" "}
        — collected, less anything already refunded or in flight.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="rfd-kind"
          label="Kind"
          required
          hint={
            kind === RefundKind.VOID
              ? "A void cancels an unsettled charge."
              : "A refund returns settled funds."
          }
        >
          {(props) => (
            <StickySelect
              {...props}
              name="kind"
              defaultValue={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value={RefundKind.REFUND}>Refund</option>
              <option value={RefundKind.VOID}>Void</option>
            </StickySelect>
          )}
        </Field>

        <Field
          id="rfd-amount"
          label={`Amount (${currency})`}
          required
          error={state.fieldErrors?.["amount"]}
        >
          {(props) => (
            <Input
              {...props}
              name="amount"
              inputMode="decimal"
              defaultValue={minorToDecimalString(refundableMinor, currency)}
              required
            />
          )}
        </Field>

        <Field id="rfd-payment" label="Against payment" className="sm:col-span-2">
          {(props) => (
            <StickySelect {...props} name="paymentId" defaultValue="">
              <option value="">— Not tied to one payment —</option>
              {payments.map((payment) => (
                <option key={payment.id} value={payment.id}>
                  {payment.reference} —{" "}
                  {minorToDecimalString(payment.amountMinor, currency)} {currency}
                </option>
              ))}
            </StickySelect>
          )}
        </Field>

        <Field
          id="rfd-reason"
          label="Reason"
          required
          error={state.fieldErrors?.["reason"]}
          className="sm:col-span-2"
        >
          {(props) => <Textarea {...props} name="reason" rows={2} required />}
        </Field>
      </div>

      <p className="text-xs text-ink-muted">
        This raises a request for approval. Someone other than you must approve
        it, and nothing moves until it is executed.
      </p>

      <div>
        <SubmitButton label={kind === RefundKind.VOID ? "Request void" : "Request refund"} />
      </div>
    </form>
  );
}
