"use client";

import { Loader2, Plus, Save } from "lucide-react";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { StickySelect } from "@/components/ui/sticky-select";
import { SupplierType } from "@/generated/prisma/enums";

import {
  saveMcoSupplierAction,
  saveSupplierAction,
  saveTfnAction,
  type ReferenceFormState,
} from "./reference-actions";

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function SubmitButton({ label, editing }: { label: string; editing: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : editing ? <Save /> : <Plus />}
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * The records these forms edit.
 *
 * Declared here rather than imported from the service, because the pages hand
 * them to a Client Component and the service is `server-only`. They are the
 * list shapes minus the columns a form has no field for.
 */
export interface SupplierRecord {
  id: string;
  name: string;
  type: SupplierType;
  externalId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  supportedProducts: readonly string[];
  isActive: boolean;
  notes: string | null;
}

export interface McoSupplierRecord {
  id: string;
  name: string;
  mailFrom: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  isActive: boolean;
  notes: string | null;
}

export interface TfnRecord {
  id: string;
  number: string;
  label: string;
  category: string | null;
  isActive: boolean;
  notes: string | null;
}

/**
 * Closes the editor once the save has been accepted.
 *
 * In an effect rather than inline, because the result only exists after the
 * action resolves — and only on success: a rejected save has to leave the
 * form open with its error and the operator's typing still in it.
 */
function useCloseOnSuccess(
  success: string | undefined,
  onSaved: (() => void) | undefined,
): void {
  useEffect(() => {
    if (success && onSaved) onSaved();
  }, [success, onSaved]);
}

function Feedback({ state }: { state: ReferenceFormState }) {
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

export function SupplierForm({
  record,
  onSaved,
}: {
  record?: SupplierRecord;
  onSaved?: () => void;
} = {}) {
  const [state, formAction] = useActionState<ReferenceFormState, FormData>(
    saveSupplierAction,
    {},
  );
  const error = (field: string) => state.fieldErrors?.[field];
  const key = record?.id ?? "new";

  useCloseOnSuccess(state.success, onSaved);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Feedback state={state} />

      {record ? <input type="hidden" name="id" value={record.id} /> : null}

      <Field id={`sup-name-${key}`} label="Supplier name" required error={error("name")}>
        {(props) => (
          <Input {...props} name="name" required defaultValue={record?.name ?? ""} />
        )}
      </Field>

      <Field id={`sup-type-${key}`} label="Type" required error={error("type")}>
        {(props) => (
          <StickySelect
            {...props}
            name="type"
            defaultValue={record?.type ?? SupplierType.AIRLINE}
          >
            {Object.values(SupplierType).map((type) => (
              <option key={type} value={type}>
                {humanise(type)}
              </option>
            ))}
          </StickySelect>
        )}
      </Field>

      <Field
        id={`sup-external-${key}`}
        label="External identifier"
        hint="Their reference for us, if they have one."
        error={error("externalId")}
      >
        {(props) => (
          <Input {...props} name="externalId" defaultValue={record?.externalId ?? ""} />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`sup-contact-${key}`} label="Contact name" error={error("contactName")}>
          {(props) => (
            <Input {...props} name="contactName" defaultValue={record?.contactName ?? ""} />
          )}
        </Field>
        <Field id={`sup-email-${key}`} label="Contact email" error={error("contactEmail")}>
          {(props) => (
            <Input
              {...props}
              name="contactEmail"
              type="email"
              defaultValue={record?.contactEmail ?? ""}
            />
          )}
        </Field>
        <Field id={`sup-phone-${key}`} label="Contact phone" error={error("contactPhone")}>
          {(props) => (
            <Input
              {...props}
              name="contactPhone"
              type="tel"
              defaultValue={record?.contactPhone ?? ""}
            />
          )}
        </Field>
        <Field id={`sup-active-${key}`} label="Active" error={error("isActive")}>
          {(props) => (
            <StickySelect
              {...props}
              name="isActive"
              defaultValue={record && !record.isActive ? "false" : "true"}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </StickySelect>
          )}
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">
          Supported products
        </legend>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="supportsFlight"
              value="true"
              className="size-4"
              defaultChecked={record?.supportedProducts.includes("FLIGHT") ?? false}
            />
            Flight
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="supportsCruise"
              value="true"
              className="size-4"
              defaultChecked={record?.supportedProducts.includes("CRUISE") ?? false}
            />
            Cruise
          </label>
        </div>
      </fieldset>

      <Field id={`sup-notes-${key}`} label="Notes" error={error("notes")}>
        {(props) => (
          <Textarea {...props} name="notes" rows={2} defaultValue={record?.notes ?? ""} />
        )}
      </Field>

      <p className="text-xs text-ink-muted">
        This is a directory entry. It does not open a connection to the airline
        or cruise line — integrations are configured separately.
      </p>

      <div>
        <SubmitButton
          label={record ? "Save changes" : "Add supplier"}
          editing={Boolean(record)}
        />
      </div>
    </form>
  );
}

export function McoSupplierForm({
  record,
  onSaved,
}: {
  /** Absent for the add panel; present when editing an existing row. */
  record?: McoSupplierRecord;
  onSaved?: () => void;
} = {}) {
  const [state, formAction] = useActionState<ReferenceFormState, FormData>(
    saveMcoSupplierAction,
    {},
  );
  const error = (field: string) => state.fieldErrors?.[field];

  // Ids must be unique per instance: the add panel and an open edit dialog are
  // on the page together, and a duplicated id points every label at one field.
  const key = record?.id ?? "new";

  useCloseOnSuccess(state.success, onSaved);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Feedback state={state} />

      {record ? <input type="hidden" name="id" value={record.id} /> : null}

      <Field id={`mco-name-${key}`} label="MCO supplier name" required error={error("name")}>
        {(props) => (
          <Input {...props} name="name" required defaultValue={record?.name ?? ""} />
        )}
      </Field>

      <Field
        id={`mco-mailfrom-${key}`}
        label="Mail from"
        hint="Address outbound confirmations are sent from."
        error={error("mailFrom")}
      >
        {(props) => (
          <Input
            {...props}
            name="mailFrom"
            type="email"
            defaultValue={record?.mailFrom ?? ""}
          />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`mco-email-${key}`} label="Contact email" error={error("contactEmail")}>
          {(props) => (
            <Input
              {...props}
              name="contactEmail"
              type="email"
              defaultValue={record?.contactEmail ?? ""}
            />
          )}
        </Field>
        <Field id={`mco-phone-${key}`} label="Contact phone" error={error("contactPhone")}>
          {(props) => (
            <Input
              {...props}
              name="contactPhone"
              type="tel"
              defaultValue={record?.contactPhone ?? ""}
            />
          )}
        </Field>
      </div>

      <Field id={`mco-active-${key}`} label="Active" error={error("isActive")}>
        {(props) => (
          <StickySelect
            {...props}
            name="isActive"
            defaultValue={record && !record.isActive ? "false" : "true"}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </StickySelect>
        )}
      </Field>

      <Field id={`mco-notes-${key}`} label="Notes" error={error("notes")}>
        {(props) => (
          <Textarea {...props} name="notes" rows={2} defaultValue={record?.notes ?? ""} />
        )}
      </Field>

      <div>
        <SubmitButton
          label={record ? "Save changes" : "Add MCO supplier"}
          editing={Boolean(record)}
        />
      </div>
    </form>
  );
}

export function TfnForm({
  record,
  onSaved,
}: {
  record?: TfnRecord;
  onSaved?: () => void;
} = {}) {
  const [state, formAction] = useActionState<ReferenceFormState, FormData>(
    saveTfnAction,
    {},
  );
  const error = (field: string) => state.fieldErrors?.[field];
  const key = record?.id ?? "new";

  useCloseOnSuccess(state.success, onSaved);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Feedback state={state} />

      {record ? <input type="hidden" name="id" value={record.id} /> : null}

      <Field id={`tfn-number-${key}`} label="Number" required error={error("number")}>
        {(props) => (
          <Input
            {...props}
            name="number"
            type="tel"
            required
            placeholder="+1 800 555 0100"
            defaultValue={record?.number ?? ""}
          />
        )}
      </Field>

      <Field id={`tfn-label-${key}`} label="Label" required error={error("label")}>
        {(props) => (
          <Input
            {...props}
            name="label"
            required
            placeholder="Main reservations line"
            defaultValue={record?.label ?? ""}
          />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`tfn-category-${key}`} label="Category" error={error("category")}>
          {(props) => (
            <Input
              {...props}
              name="category"
              placeholder="Sales, support"
              defaultValue={record?.category ?? ""}
            />
          )}
        </Field>
        <Field id={`tfn-active-${key}`} label="Active" error={error("isActive")}>
          {(props) => (
            <StickySelect
              {...props}
              name="isActive"
              defaultValue={record && !record.isActive ? "false" : "true"}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </StickySelect>
          )}
        </Field>
      </div>

      <Field id={`tfn-notes-${key}`} label="Notes" error={error("notes")}>
        {(props) => (
          <Textarea {...props} name="notes" rows={2} defaultValue={record?.notes ?? ""} />
        )}
      </Field>

      <p className="text-xs text-ink-muted">
        Call routing is sensitive, so every change here is written to the audit
        log.
      </p>

      <div>
        <SubmitButton
          label={record ? "Save changes" : "Add number"}
          editing={Boolean(record)}
        />
      </div>
    </form>
  );
}
