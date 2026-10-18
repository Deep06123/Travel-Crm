"use client";

import { Check, Loader2, Play, X } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { RefundStatus } from "@/generated/prisma/enums";
import { minorToDecimalString } from "@/lib/financial/money";

import {
  decideRefundAction,
  executeRefundAction,
  type FinanceFormState,
} from "./actions";

function Feedback({ state }: { state: FinanceFormState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-md bg-status-danger-bg px-2 py-1.5 text-xs text-status-danger">
        {state.error}
      </p>
    );
  }

  if (state.success) {
    return (
      <p role="status" className="rounded-md bg-status-success-bg px-2 py-1.5 text-xs text-status-success">
        {state.success}
      </p>
    );
  }

  return null;
}

function PendingButton({
  label,
  icon,
  variant = "primary",
}: {
  label: string;
  icon: React.ReactNode;
  variant?: "primary" | "destructive" | "secondary";
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : icon}
      {label}
    </Button>
  );
}

/**
 * Approve, reject or execute a refund.
 *
 * Which controls appear follows the refund's own lifecycle, so an operator is
 * never offered a transition the service would reject. The service re-checks
 * regardless — including that the approver is not the requester.
 */
export function RefundDecision({
  refundId,
  status,
  currency,
  requestedAmountMinor,
  canApprove,
  canProcess,
}: {
  refundId: string;
  status: RefundStatus;
  currency: string;
  requestedAmountMinor: number;
  canApprove: boolean;
  canProcess: boolean;
}) {
  const [decisionState, decisionAction] = useActionState<FinanceFormState, FormData>(
    decideRefundAction,
    {},
  );
  const [executeState, executeAction] = useActionState<FinanceFormState, FormData>(
    executeRefundAction,
    {},
  );
  const [mode, setMode] = useState<"none" | "approve" | "reject">("none");

  if (status === RefundStatus.PENDING && canApprove) {
    return (
      <div className="flex flex-col gap-2">
        <Feedback state={decisionState} />

        {mode === "none" ? (
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={() => setMode("approve")}>
              <Check />
              Approve
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setMode("reject")}>
              <X />
              Reject
            </Button>
          </div>
        ) : (
          <form action={decisionAction} className="flex flex-col gap-2">
            <input type="hidden" name="refundId" value={refundId} />
            <input type="hidden" name="decision" value={mode} />

            {mode === "approve" ? (
              <Field
                id={`amount-${refundId}`}
                label={`Approved amount (${currency})`}
                hint="Cannot exceed the amount requested."
                error={decisionState.fieldErrors?.["amount"]}
              >
                {(props) => (
                  <Input
                    {...props}
                    name="amount"
                    inputMode="decimal"
                    defaultValue={minorToDecimalString(requestedAmountMinor, currency)}
                  />
                )}
              </Field>
            ) : null}

            <Field
              id={`note-${refundId}`}
              label={mode === "reject" ? "Reason for rejecting" : "Note"}
              required={mode === "reject"}
              error={decisionState.fieldErrors?.["note"]}
            >
              {(props) => (
                <Textarea {...props} name="note" rows={2} required={mode === "reject"} />
              )}
            </Field>

            <div className="flex items-center gap-1.5">
              <PendingButton
                label={mode === "approve" ? "Confirm approval" : "Confirm rejection"}
                icon={mode === "approve" ? <Check /> : <X />}
                variant={mode === "approve" ? "primary" : "destructive"}
              />
              <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  if (status === RefundStatus.APPROVED && canProcess) {
    return (
      <form action={executeAction} className="flex flex-col gap-2">
        <input type="hidden" name="refundId" value={refundId} />
        <Feedback state={executeState} />

        <Field
          id={`exec-${refundId}`}
          label="How was this executed?"
          required
          hint="No provider is integrated — this records an operator action."
          error={executeState.fieldErrors?.["note"]}
        >
          {(props) => (
            <Textarea
              {...props}
              name="note"
              rows={2}
              required
              placeholder="e.g. refunded at the airline desk, reference ABC123"
            />
          )}
        </Field>

        <div>
          <PendingButton label="Record as executed" icon={<Play />} />
        </div>
      </form>
    );
  }

  return <span className="text-xs text-ink-subtle">—</span>;
}
