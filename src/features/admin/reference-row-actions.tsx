"use client";

import { Pencil, PowerOff, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";

import { deleteReferenceAction } from "./reference-actions";
import {
  McoSupplierForm,
  SupplierForm,
  TfnForm,
  type McoSupplierRecord,
  type SupplierRecord,
  type TfnRecord,
} from "./reference-forms";

/**
 * Edit and remove, in the last column of a reference table.
 *
 * Edit opens the same form the side panel uses, prefilled, in a dialog. A
 * dialog rather than an expanding row because these live inside a `<table>`:
 * a form rendered from a cell would be trapped in one column, and the top
 * layer has no such problem.
 *
 * Remove is two different actions wearing one slot. With nothing pointing at
 * the record it is a real delete, behind a typed confirmation because it
 * cannot be undone. Once a booking references it the database refuses — the
 * relation is `onDelete: Restrict` — so the control becomes Deactivate, which
 * takes the record out of every picker and leaves the history legible. The
 * count is shown either way, because "why can I not delete this" should be
 * answerable without opening a booking.
 */

/** What each row needs to describe itself in the dialogs. */
interface RowSubject {
  id: string;
  /** The name shown in the confirmation, and typed back to delete. */
  name: string;
  isActive: boolean;
  /** How many bookings point at it. Non-zero means delete is impossible. */
  usageCount: number;
}

function EditDialog({
  subject,
  children,
}: {
  subject: RowSubject;
  children: (close: () => void) => React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Open/closed is state, and the ref is only touched from the effect that
  // syncs the element to it. The obvious version — handing `children` a
  // closure over `dialogRef.current` — reads a ref during render, which is
  // exactly what `react-hooks/refs` is for: the child would capture whatever
  // the ref held at render time rather than when the save finally resolves.
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // `showModal()` on an already-open dialog throws, so both directions are
    // guarded rather than fired on every state change.
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        <Pencil />
        Edit
      </Button>

      <dialog
        ref={dialogRef}
        // Escape and the backdrop close the element directly, without going
        // through the state — this puts the two back in step.
        onClose={close}
        className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">
              Edit {subject.name}
            </h2>
            <Button type="button" size="sm" variant="secondary" onClick={close}>
              Close
            </Button>
          </div>

          {children(close)}
        </div>
      </dialog>
    </>
  );
}

/**
 * Delete, or deactivate where deleting is impossible.
 *
 * An already-inactive record in use offers nothing: it is as removed as it can
 * be, and a second Deactivate would be a button that does nothing.
 */
function RemoveControl({
  kind,
  subject,
  noun,
}: {
  kind: "supplier" | "mcoSupplier" | "tfn";
  subject: RowSubject;
  noun: string;
}) {
  if (subject.usageCount === 0) {
    return (
      <ConfirmButton
        action={deleteReferenceAction}
        fields={{ kind, id: subject.id }}
        label="Delete"
        pendingLabel="Deleting…"
        icon={<Trash2 />}
        title={`Delete ${subject.name}`}
        confirmLabel="Delete for good"
        confirmWord={subject.name}
        description={
          <>
            Nothing references this {noun}, so it can be removed outright. This
            cannot be undone — only the audit entry remains.
          </>
        }
      />
    );
  }

  if (!subject.isActive) {
    return (
      <span className="text-xs text-ink-subtle">
        {subject.usageCount} booking{subject.usageCount === 1 ? "" : "s"} — kept
        for history
      </span>
    );
  }

  return (
    <ConfirmButton
      action={deleteReferenceAction}
      fields={{ kind, id: subject.id, deactivate: "true" }}
      label="Deactivate"
      pendingLabel="Deactivating…"
      icon={<PowerOff />}
      variant="secondary"
      title={`Deactivate ${subject.name}`}
      confirmLabel="Deactivate"
      description={
        <>
          {subject.usageCount} booking{subject.usageCount === 1 ? "" : "s"}{" "}
          reference this {noun}, so it cannot be deleted without taking their
          history with it. Deactivating stops it being offered on new bookings
          and leaves everything already recorded intact. You can reactivate it
          from Edit at any time.
        </>
      }
    />
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2">{children}</div>;
}

export function SupplierRowActions({
  record,
  usageCount,
}: {
  record: SupplierRecord;
  usageCount: number;
}) {
  const subject = {
    id: record.id,
    name: record.name,
    isActive: record.isActive,
    usageCount,
  };

  return (
    <Layout>
      <EditDialog subject={subject}>
        {(close) => <SupplierForm record={record} onSaved={close} />}
      </EditDialog>
      <RemoveControl kind="supplier" subject={subject} noun="supplier" />
    </Layout>
  );
}

export function McoSupplierRowActions({
  record,
  usageCount,
}: {
  record: McoSupplierRecord;
  usageCount: number;
}) {
  const subject = {
    id: record.id,
    name: record.name,
    isActive: record.isActive,
    usageCount,
  };

  return (
    <Layout>
      <EditDialog subject={subject}>
        {(close) => <McoSupplierForm record={record} onSaved={close} />}
      </EditDialog>
      <RemoveControl kind="mcoSupplier" subject={subject} noun="MCO supplier" />
    </Layout>
  );
}

export function TfnRowActions({
  record,
  usageCount,
}: {
  record: TfnRecord;
  usageCount: number;
}) {
  const subject = {
    id: record.id,
    // The label, not the number: it is what the table shows and what an
    // operator would type back without squinting at digits.
    name: record.label,
    isActive: record.isActive,
    usageCount,
  };

  return (
    <Layout>
      <EditDialog subject={subject}>
        {(close) => <TfnForm record={record} onSaved={close} />}
      </EditDialog>
      <RemoveControl kind="tfn" subject={subject} noun="number" />
    </Layout>
  );
}
