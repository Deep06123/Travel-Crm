"use client";

import { Loader2, Plus } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
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

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Plus />}
      {pending ? "Saving…" : label}
    </Button>
  );
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

export function SupplierForm() {
  const [state, formAction] = useActionState<ReferenceFormState, FormData>(
    saveSupplierAction,
    {},
  );
  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Feedback state={state} />

      <Field id="sup-name" label="Supplier name" required error={error("name")}>
        {(props) => <Input {...props} name="name" required />}
      </Field>

      <Field id="sup-type" label="Type" required error={error("type")}>
        {(props) => (
          <Select {...props} name="type" defaultValue={SupplierType.AIRLINE}>
            {Object.values(SupplierType).map((type) => (
              <option key={type} value={type}>
                {humanise(type)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        id="sup-external"
        label="External identifier"
        hint="Their reference for us, if they have one."
        error={error("externalId")}
      >
        {(props) => <Input {...props} name="externalId" />}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="sup-contact" label="Contact name" error={error("contactName")}>
          {(props) => <Input {...props} name="contactName" />}
        </Field>
        <Field id="sup-email" label="Contact email" error={error("contactEmail")}>
          {(props) => <Input {...props} name="contactEmail" type="email" />}
        </Field>
        <Field id="sup-phone" label="Contact phone" error={error("contactPhone")}>
          {(props) => <Input {...props} name="contactPhone" type="tel" />}
        </Field>
        <Field id="sup-active" label="Active" error={error("isActive")}>
          {(props) => (
            <Select {...props} name="isActive" defaultValue="true">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          )}
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">
          Supported products
        </legend>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="supportsFlight" value="true" className="size-4" />
            Flight
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="supportsCruise" value="true" className="size-4" />
            Cruise
          </label>
        </div>
      </fieldset>

      <Field id="sup-notes" label="Notes" error={error("notes")}>
        {(props) => <Textarea {...props} name="notes" rows={2} />}
      </Field>

      <p className="text-xs text-ink-muted">
        This is a directory entry. It does not open a connection to the airline
        or cruise line — integrations are configured separately.
      </p>

      <div>
        <SubmitButton label="Add supplier" />
      </div>
    </form>
  );
}

export function McoSupplierForm() {
  const [state, formAction] = useActionState<ReferenceFormState, FormData>(
    saveMcoSupplierAction,
    {},
  );
  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Feedback state={state} />

      <Field id="mco-name" label="MCO supplier name" required error={error("name")}>
        {(props) => <Input {...props} name="name" required />}
      </Field>

      <Field
        id="mco-mailfrom"
        label="Mail from"
        hint="Address outbound confirmations are sent from."
        error={error("mailFrom")}
      >
        {(props) => <Input {...props} name="mailFrom" type="email" />}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="mco-email" label="Contact email" error={error("contactEmail")}>
          {(props) => <Input {...props} name="contactEmail" type="email" />}
        </Field>
        <Field id="mco-phone" label="Contact phone" error={error("contactPhone")}>
          {(props) => <Input {...props} name="contactPhone" type="tel" />}
        </Field>
      </div>

      <Field id="mco-active" label="Active" error={error("isActive")}>
        {(props) => (
          <Select {...props} name="isActive" defaultValue="true">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        )}
      </Field>

      <Field id="mco-notes" label="Notes" error={error("notes")}>
        {(props) => <Textarea {...props} name="notes" rows={2} />}
      </Field>

      <div>
        <SubmitButton label="Add MCO supplier" />
      </div>
    </form>
  );
}

export function TfnForm() {
  const [state, formAction] = useActionState<ReferenceFormState, FormData>(
    saveTfnAction,
    {},
  );
  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Feedback state={state} />

      <Field id="tfn-number" label="Number" required error={error("number")}>
        {(props) => <Input {...props} name="number" type="tel" required placeholder="+1 800 555 0100" />}
      </Field>

      <Field id="tfn-label" label="Label" required error={error("label")}>
        {(props) => <Input {...props} name="label" required placeholder="Main reservations line" />}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="tfn-category" label="Category" error={error("category")}>
          {(props) => <Input {...props} name="category" placeholder="Sales, support" />}
        </Field>
        <Field id="tfn-active" label="Active" error={error("isActive")}>
          {(props) => (
            <Select {...props} name="isActive" defaultValue="true">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          )}
        </Field>
      </div>

      <Field id="tfn-notes" label="Notes" error={error("notes")}>
        {(props) => <Textarea {...props} name="notes" rows={2} />}
      </Field>

      <p className="text-xs text-ink-muted">
        Call routing is sensitive, so every change here is written to the audit
        log.
      </p>

      <div>
        <SubmitButton label="Add number" />
      </div>
    </form>
  );
}
