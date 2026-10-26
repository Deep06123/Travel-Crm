"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { McoStatusBadge } from "@/components/ui/status-badge";
import type { McoStatus } from "@/generated/prisma/enums";

import { updateMcoAction, type McoState } from "./mco-actions";

/** MCO statuses whose move must carry a written reason. Mirrors the server. */
const REASON_REQUIRED: readonly string[] = ["REJECTED", "NOT_APPLICABLE"];

/** Labels matching the badge, so the dropdown and the badge agree. */
const LABELS: Record<McoStatus, string> = {
  NOT_APPLICABLE: "Not applicable",
  PENDING: "Pending",
  SUBMITTED: "Submitted",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
};

export interface McoSupplierOption {
  id: string;
  name: string;
}

function SubmitButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || blocked}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Saving…" : "Update MCO"}
    </Button>
  );
}

/**
 * MCO settlement control.
 *
 * Supplier and status are one form because submitting an MCO requires a
 * supplier: naming one and sending the MCO to them is a single decision, and
 * splitting it would mean saving the supplier, waiting for the page to come
 * back, then moving the status.
 *
 * Only transitions the server would accept are offered, and the ones that must
 * be accounted for ask for a reason. Both are conveniences — the MCO service
 * re-checks the matrix, the supplier and the reason regardless of what this
 * form submits.
 */
export function McoControl({
  bookingId,
  currentStatus,
  currentSupplierId,
  allowedStatuses,
  suppliers,
  supplierLocked,
}: {
  bookingId: string;
  currentStatus: McoStatus;
  currentSupplierId: string | null;
  allowedStatuses: readonly McoStatus[];
  suppliers: readonly McoSupplierOption[];
  /** True once the MCO has gone to its supplier and may not be re-pointed. */
  supplierLocked: boolean;
}) {
  const [state, formAction] = useActionState<McoState, FormData>(
    updateMcoAction,
    {},
  );
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>(currentSupplierId ?? "");

  const needsReason = REASON_REQUIRED.includes(selectedStatus);
  const supplierDirty = supplierId !== (currentSupplierId ?? "");
  const nothingToDo = selectedStatus === "" && !supplierDirty;

  // The assigned supplier may have been retired since; it is still shown so
  // the field does not silently read as empty on a booking that has one.
  const assignedMissing =
    currentSupplierId !== null &&
    !suppliers.some((supplier) => supplier.id === currentSupplierId);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="bookingId" value={bookingId} />

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-ink-muted uppercase">
          Current
        </span>
        <McoStatusBadge status={currentStatus} />
      </div>

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

      <Field
        id="mcoSupplierId"
        label="MCO supplier"
        hint={
          supplierLocked
            ? "Fixed once the MCO has gone to the supplier."
            : "Required before the MCO can be submitted."
        }
      >
        {(props) => (
          <Select
            {...props}
            name="mcoSupplierId"
            value={supplierId}
            disabled={supplierLocked}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">— None —</option>
            {assignedMissing ? (
              <option value={currentSupplierId ?? ""}>
                Currently assigned (inactive)
              </option>
            ) : null}
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {/* A disabled select submits nothing, which the action would read as
          "clear the supplier". The hidden field keeps the value intact. */}
      {supplierLocked ? (
        <input
          type="hidden"
          name="mcoSupplierId"
          value={currentSupplierId ?? ""}
        />
      ) : null}

      {allowedStatuses.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {LABELS[currentStatus]} is a final MCO status. Unwinding a settled MCO
          means raising a new one.
        </p>
      ) : (
        <Field id="mcoToStatus" label="Move to">
          {(props) => (
            <Select
              {...props}
              name="toStatus"
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
            >
              <option value="">— Leave unchanged —</option>
              {allowedStatuses.map((status) => (
                <option key={status} value={status}>
                  {LABELS[status]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      {needsReason ? (
        <Field
          id="mcoReason"
          label="Reason"
          required
          hint="Recorded against the booking in the audit log."
        >
          {(props) => <Textarea {...props} name="reason" rows={2} required />}
        </Field>
      ) : null}

      <div>
        <SubmitButton blocked={nothingToDo} />
      </div>
    </form>
  );
}
