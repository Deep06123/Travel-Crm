"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { StickySelect } from "@/components/ui/sticky-select";
import { Panel } from "@/components/ui/panel";
import { CustomerStatus } from "@/generated/prisma/enums";

import type { CustomerFormState } from "./actions";

export interface CustomerFormValues {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  status?: CustomerStatus;
  billingAddressLine1?: string;
  billingAddressLine2?: string;
  billingCity?: string;
  billingState?: string;
  billingPostalCode?: string;
  billingCountry?: string;
  preferredLanguage?: string;
  notes?: string;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Shown when the submitted contact details match an existing customer.
 *
 * The operator can open the match or confirm that this really is a different
 * person; the hidden `confirmedDuplicate` field carries that decision back.
 */
function DuplicateWarning({ state }: { state: CustomerFormState }) {
  if (!state.duplicates?.length) return null;

  return (
    <div className="mb-4 rounded-md border border-status-warning/30 bg-status-warning-bg p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-status-warning">
        <AlertTriangle className="size-4" />
        This may already be an existing customer
      </p>

      <ul className="mt-2 space-y-1.5">
        {state.duplicates.map((match) => (
          <li key={match.id} className="text-sm">
            <Link
              href={`/admin/customers/${match.id}`}
              className="font-medium text-navy-500 hover:underline"
            >
              {match.reference} — {match.firstName} {match.lastName}
            </Link>
            <span className="text-ink-muted">
              {" "}
              · same {match.matchedOn} ({match.matchedOn === "email" ? match.email : match.phone})
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-ink-muted">
        Open the match if it is the same person. Submit again to create a
        separate record.
      </p>

      <input type="hidden" name="confirmedDuplicate" value="true" />
    </div>
  );
}

export function CustomerForm({
  action,
  defaults = {},
  submitLabel,
  cancelHref,
}: {
  action: (
    state: CustomerFormState,
    formData: FormData,
  ) => Promise<CustomerFormState>;
  defaults?: CustomerFormValues;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<CustomerFormState, FormData>(
    action,
    {},
  );

  // A rejected submission replays what was typed rather than clearing the form.
  const value = (field: keyof CustomerFormValues): string =>
    state.values?.[field] ?? (defaults[field] ?? "");

  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <p
          role="alert"
          className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
        >
          {state.error}
        </p>
      ) : null}

      <Panel title="Contact details" collapsible={false}>
        <DuplicateWarning state={state} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="firstName" label="First name" required error={error("firstName")}>
            {(props) => (
              <Input {...props} name="firstName" defaultValue={value("firstName")} required />
            )}
          </Field>

          <Field id="lastName" label="Last name" required error={error("lastName")}>
            {(props) => (
              <Input {...props} name="lastName" defaultValue={value("lastName")} required />
            )}
          </Field>

          <Field
            id="email"
            label="Email"
            hint="An email address or a phone number is required."
            error={error("email")}
          >
            {(props) => (
              <Input {...props} name="email" type="email" defaultValue={value("email")} />
            )}
          </Field>

          <Field id="phone" label="Phone" error={error("phone")}>
            {(props) => (
              <Input {...props} name="phone" type="tel" defaultValue={value("phone")} />
            )}
          </Field>

          <Field id="status" label="Status" error={error("status")}>
            {(props) => (
              <StickySelect {...props} name="status" defaultValue={value("status") || CustomerStatus.ACTIVE}>
                <option value={CustomerStatus.ACTIVE}>Active</option>
                <option value={CustomerStatus.INACTIVE}>Inactive</option>
                <option value={CustomerStatus.BLOCKED}>Blocked</option>
              </StickySelect>
            )}
          </Field>

          <Field id="preferredLanguage" label="Preferred language" error={error("preferredLanguage")}>
            {(props) => (
              <StickySelect
                {...props}
                name="preferredLanguage"
                defaultValue={value("preferredLanguage") || "en"}
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
              </StickySelect>
            )}
          </Field>
        </div>
      </Panel>

      <Panel title="Billing address" defaultOpen={false}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="billingAddressLine1" label="Address line 1" error={error("billingAddressLine1")} className="sm:col-span-2">
            {(props) => (
              <Input {...props} name="billingAddressLine1" defaultValue={value("billingAddressLine1")} />
            )}
          </Field>

          <Field id="billingAddressLine2" label="Address line 2" error={error("billingAddressLine2")} className="sm:col-span-2">
            {(props) => (
              <Input {...props} name="billingAddressLine2" defaultValue={value("billingAddressLine2")} />
            )}
          </Field>

          <Field id="billingCity" label="City" error={error("billingCity")}>
            {(props) => <Input {...props} name="billingCity" defaultValue={value("billingCity")} />}
          </Field>

          <Field id="billingState" label="State or province" error={error("billingState")}>
            {(props) => <Input {...props} name="billingState" defaultValue={value("billingState")} />}
          </Field>

          <Field id="billingPostalCode" label="Postal code" error={error("billingPostalCode")}>
            {(props) => (
              <Input {...props} name="billingPostalCode" defaultValue={value("billingPostalCode")} />
            )}
          </Field>

          <Field id="billingCountry" label="Country" error={error("billingCountry")}>
            {(props) => (
              <Input {...props} name="billingCountry" defaultValue={value("billingCountry")} />
            )}
          </Field>
        </div>
      </Panel>

      <Panel title="Internal notes" defaultOpen={false}>
        <Field id="notes" label="Notes" hint="Visible to staff only." error={error("notes")}>
          {(props) => <Textarea {...props} name="notes" rows={4} defaultValue={value("notes")} />}
        </Field>
      </Panel>

      <div className="flex items-center gap-2">
        <SubmitButton label={submitLabel} />
        {/* A link, not a button wrapping a link — nesting the two is invalid
            HTML and breaks keyboard navigation. */}
        <Link href={cancelHref} className={buttonVariants({ variant: "secondary" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
