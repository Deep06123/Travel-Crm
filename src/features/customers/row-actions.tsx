"use client";

import { Pencil, PowerOff, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";

import {
  reactivateCustomerAction,
  removeCustomerAction,
} from "./actions";

/**
 * Edit and remove, in the last column of the customer list.
 *
 * Edit is a link rather than a dialog: a customer has billing address, contact
 * details and preferences, and the existing profile page already edits all of
 * them properly. Reproducing that in a modal would be a second form to keep in
 * step with the first.
 *
 * Remove splits the way the reference tables do. A customer with no bookings,
 * payments, documents or cases is a duplicate created on a bad phone line and
 * can go; one with any of those is a financial record, the foreign keys are
 * `Restrict`, and the honest action is to mark them inactive.
 */
export function CustomerRowActions({
  customerId,
  name,
  status,
  bookingCount,
}: {
  customerId: string;
  /** Shown in the confirmation, and typed back to delete. */
  name: string;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
  /**
   * Bookings only. Payments, documents and cases also block a delete, and the
   * server checks all four — a customer with none of the four almost always
   * has no bookings either, so this is the cheap signal for which control to
   * draw. The action answers with the real reason if the guess was wrong.
   */
  bookingCount: number;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Link
        href={`/admin/customers/${customerId}`}
        className={buttonVariants({ variant: "secondary", size: "sm" })}
      >
        <Pencil />
        Edit
      </Link>

      {bookingCount === 0 ? (
        <ConfirmButton
          action={removeCustomerAction}
          fields={{ customerId }}
          label="Delete"
          pendingLabel="Deleting…"
          icon={<Trash2 />}
          title={`Delete ${name}`}
          confirmLabel="Delete for good"
          confirmWord={name}
          description={
            <>
              This customer has no bookings, payments, documents or service
              cases, so the record can be removed outright. Their notes go with
              them. This cannot be undone — only the audit entry remains.
            </>
          }
        />
      ) : status === "ACTIVE" ? (
        <ConfirmButton
          action={removeCustomerAction}
          fields={{ customerId, deactivate: "true" }}
          label="Deactivate"
          pendingLabel="Deactivating…"
          icon={<PowerOff />}
          variant="secondary"
          title={`Mark ${name} inactive`}
          confirmLabel="Mark inactive"
          description={
            <>
              {bookingCount} booking{bookingCount === 1 ? "" : "s"} reference
              this customer, so the record cannot be deleted without taking
              that history with it. Marking them inactive stops them reading as
              a current customer and changes nothing already recorded.
            </>
          }
        />
      ) : (
        <ConfirmButton
          action={reactivateCustomerAction}
          fields={{ customerId }}
          label="Reactivate"
          pendingLabel="Reactivating…"
          icon={<RotateCcw />}
          variant="secondary"
          title={`Reactivate ${name}`}
          confirmLabel="Reactivate"
          description={
            <>
              Puts the customer back to active. Use this when someone was
              marked inactive or blocked and is trading with us again.
            </>
          }
        />
      )}
    </div>
  );
}
