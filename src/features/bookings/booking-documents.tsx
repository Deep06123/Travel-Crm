"use client";

import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Field } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { StickySelect } from "@/components/ui/sticky-select";
import { DocumentCategory, DocumentOrigin } from "@/generated/prisma/enums";

import { BOOKING_DOCUMENTS_FIELD } from "./document-attachments.constants";

/**
 * Documents attached while the booking is being created.
 *
 * The files ride along in the booking form's own `FormData` — this is not a
 * nested `<form>`, which the HTML parser would drop, and not a separate upload
 * that could leave orphaned files behind if the booking is then abandoned.
 * The server stores them against the booking once it exists; see
 * `document-attachments.ts`.
 *
 * Each chosen file gets a download link back to the operator's own copy. The
 * document is not on the server yet, so there is nothing to fetch — the link
 * points at an object URL over the selected `File`, which is enough to confirm
 * the right scan was picked before the booking is saved. Once it is saved, the
 * booking page serves the stored copy through the protected document route.
 */

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type Chosen = { file: File; url: string };

export function BookingDocuments({
  error,
}: {
  error: (field: string) => string | undefined;
}) {
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Each object URL pins its blob in memory until it is revoked, so the
  // previous set is released whenever the selection changes and on unmount.
  const previous = useRef<Chosen[]>([]);
  useEffect(() => {
    for (const item of previous.current) {
      if (!chosen.includes(item)) URL.revokeObjectURL(item.url);
    }
    previous.current = chosen;
  }, [chosen]);
  useEffect(
    () => () => {
      for (const item of previous.current) URL.revokeObjectURL(item.url);
    },
    [],
  );

  const problem = error(BOOKING_DOCUMENTS_FIELD);

  return (
    <Panel title="Documents" defaultOpen={problem !== undefined}>
      <div className="flex flex-col gap-4">
        {problem ? (
          <p
            role="alert"
            className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
          >
            {problem} Choose the files again — a browser clears a file input
            when the form comes back, and will not let a page refill one.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="documentCategory" label="Category">
            {(props) => (
              <StickySelect
                {...props}
                name="documentCategory"
                defaultValue={DocumentCategory.BOOKING_CONFIRMATION}
              >
                {Object.values(DocumentCategory).map((category) => (
                  <option key={category} value={category}>
                    {humanise(category)}
                  </option>
                ))}
              </StickySelect>
            )}
          </Field>

          <Field
            id="documentOrigin"
            label="Origin"
            hint="Only mark provider-issued if the cruise line or airline produced the file."
          >
            {(props) => (
              <StickySelect
                {...props}
                name="documentOrigin"
                defaultValue={DocumentOrigin.CUSTOMER_SUPPLIED}
              >
                <option value={DocumentOrigin.CUSTOMER_SUPPLIED}>
                  Customer supplied
                </option>
                <option value={DocumentOrigin.PROVIDER_ISSUED}>
                  Provider issued
                </option>
                <option value={DocumentOrigin.INTERNALLY_GENERATED}>
                  Internally generated
                </option>
              </StickySelect>
            )}
          </Field>
        </div>

        <Field
          id={BOOKING_DOCUMENTS_FIELD}
          label="Upload documents"
          hint="PDF, PNG, JPEG or WebP. Attached to the booking once it is created, and stored privately — never served by public URL."
        >
          {(props) => (
            <input
              {...props}
              ref={inputRef}
              type="file"
              name={BOOKING_DOCUMENTS_FIELD}
              multiple
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="w-full rounded-md border border-line-strong bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-navy-500 file:px-3 file:py-1.5 file:text-sm file:text-white"
              onChange={(event) =>
                setChosen(
                  [...(event.target.files ?? [])].map((file) => ({
                    file,
                    url: URL.createObjectURL(file),
                  })),
                )
              }
            />
          )}
        </Field>

        {chosen.length > 0 ? (
          <ul className="divide-y divide-line rounded-md border border-line">
            {chosen.map(({ file, url }) => (
              <li
                key={`${file.name}-${file.size}-${file.lastModified}`}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{file.name}</p>
                  <p className="text-xs text-ink-muted">
                    {formatSize(file.size)}
                  </p>
                </div>

                <a
                  href={url}
                  download={file.name}
                  className="flex shrink-0 items-center gap-1.5 rounded p-1.5 text-sm text-ink-muted hover:bg-surface-sunken hover:text-navy-500"
                >
                  <Download className="size-4" />
                  <span className="sr-only sm:not-sr-only">Download</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        {chosen.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => {
                // Clearing the list alone would leave the files in the input
                // and still submit them; the control itself has to be reset.
                if (inputRef.current) inputRef.current.value = "";
                setChosen([]);
              }}
              className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-status-danger"
            >
              <X className="size-4" />
              Clear selection
            </button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
