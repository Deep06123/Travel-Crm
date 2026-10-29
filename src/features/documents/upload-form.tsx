"use client";

import { Loader2, Upload } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { StickySelect } from "@/components/ui/sticky-select";
import { DocumentCategory, DocumentOrigin } from "@/generated/prisma/enums";

import { uploadDocumentAction, type DocumentFormState } from "./actions";

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Upload />}
      {pending ? "Uploading…" : "Upload"}
    </Button>
  );
}

/**
 * Document upload.
 *
 * `origin` is an explicit choice rather than an inference: the plan requires a
 * generated PDF to be labelled as internally generated unless there is evidence
 * the provider issued it, and only the person uploading knows which this is.
 */
export function DocumentUploadForm({
  bookingId,
  customerId,
  defaultCategory = DocumentCategory.BOOKING_CONFIRMATION,
}: {
  bookingId?: string;
  customerId?: string;
  defaultCategory?: DocumentCategory;
}) {
  const [state, formAction] = useActionState<DocumentFormState, FormData>(
    uploadDocumentAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {bookingId ? <input type="hidden" name="bookingId" value={bookingId} /> : null}
      {customerId ? <input type="hidden" name="customerId" value={customerId} /> : null}

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

      <Field id="doc-title" label="Title" required>
        {(props) => (
          <Input {...props} name="title" required placeholder="E-ticket for MV70056" />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="doc-category" label="Category" required>
          {(props) => (
            <StickySelect {...props} name="category" defaultValue={defaultCategory}>
              {Object.values(DocumentCategory).map((category) => (
                <option key={category} value={category}>
                  {humanise(category)}
                </option>
              ))}
            </StickySelect>
          )}
        </Field>

        <Field
          id="doc-origin"
          label="Origin"
          required
          hint="Only mark provider-issued if the airline or cruise line produced this file."
        >
          {(props) => (
            <StickySelect {...props} name="origin" defaultValue={DocumentOrigin.PROVIDER_ISSUED}>
              <option value={DocumentOrigin.PROVIDER_ISSUED}>Provider issued</option>
              <option value={DocumentOrigin.CUSTOMER_SUPPLIED}>Customer supplied</option>
              <option value={DocumentOrigin.INTERNALLY_GENERATED}>
                Internally generated
              </option>
            </StickySelect>
          )}
        </Field>
      </div>

      <Field
        id="doc-file"
        label="File"
        required
        hint="PDF, PNG, JPEG or WebP. Stored privately and never served by public URL."
      >
        {(props) => (
          <input
            {...props}
            type="file"
            name="file"
            required
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="w-full rounded-md border border-line-strong bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-navy-500 file:px-3 file:py-1.5 file:text-sm file:text-white"
          />
        )}
      </Field>

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
