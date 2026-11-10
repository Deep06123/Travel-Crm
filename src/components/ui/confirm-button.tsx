"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

/**
 * A destructive row action behind a confirmation.
 *
 * Every list in the admin needs the same thing — a small button in the last
 * column that removes or disables the row — and the part that must not be
 * reinvented per table is the asking. A single click on a table row is how an
 * audit trail fills with changes nobody can account for: a row carries almost
 * no context, and the cursor is already there.
 *
 * `confirmWord` adds the stricter form used where the record cannot be
 * recovered: the operator types the name back before the button will submit.
 * Where the action is reversible — deactivating — a plain Confirm is enough,
 * and demanding typing for it only teaches people to type without reading.
 *
 * The server re-checks everything. This is the prompt, never the control.
 */

/** What every action behind this button returns. */
export interface ConfirmActionState {
  error?: string;
  success?: string;
}

export function ConfirmButton({
  action,
  fields,
  label,
  pendingLabel,
  title,
  description,
  confirmLabel,
  confirmWord,
  variant = "destructive",
  icon,
  disabled,
  disabledReason,
  onSuccess,
}: {
  action: (
    previous: ConfirmActionState,
    formData: FormData,
  ) => Promise<ConfirmActionState>;
  /** Hidden inputs identifying the record, e.g. `{ kind: "tfn", id }`. */
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  /** When set, the operator must type this exactly before confirming. */
  confirmWord?: string;
  variant?: "destructive" | "secondary";
  icon?: ReactNode;
  /** Renders the trigger unclickable, with the reason as its tooltip. */
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Run once the action reports success. For callers holding state the action
   * has just invalidated — a selection whose rows are now gone.
   */
  onSuccess?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState<ConfirmActionState, FormData>(
    action,
    {},
  );
  const [typed, setTyped] = useState("");

  // A refusal arrives with the dialog already closed by the submission, and an
  // error nobody sees is the same as no error.
  useEffect(() => {
    if (state.error && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, [state.error]);

  // Guarded on the state object rather than its message: every result is a
  // fresh object, so two deletes that happen to report the same wording still
  // call back twice, while a plain re-render calls back not at all.
  const announced = useRef<ConfirmActionState | null>(null);
  useEffect(() => {
    if (state.success && announced.current !== state) {
      announced.current = state;
      onSuccess?.();
    }
  }, [state, onSuccess]);

  function close() {
    setTyped("");
    dialogRef.current?.close();
  }

  const satisfied =
    confirmWord === undefined ||
    typed.trim().toLowerCase() === confirmWord.trim().toLowerCase();

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={variant}
        onClick={() => dialogRef.current?.showModal()}
        disabled={disabled ?? false}
        {...(disabledReason ? { title: disabledReason } : {})}
      >
        {icon}
        {label}
      </Button>

      <dialog
        ref={dialogRef}
        onClose={close}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
      >
        <form action={formAction} className="flex flex-col gap-3 p-5">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          <h2 className="text-base font-semibold text-ink">{title}</h2>

          {state.error ? (
            <p
              role="alert"
              className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
            >
              {state.error}
            </p>
          ) : null}

          <div className="text-sm text-ink-muted">{description}</div>

          {confirmWord ? (
            <label className="flex flex-col gap-1 text-sm">
              {/* The word is set apart rather than run into the sentence.
                  Plain text read as "type [something] to confirm", so people
                  typed the word "confirm" and met a button that stayed dead
                  with no explanation. */}
              <span className="font-medium text-ink">
                Type{" "}
                <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-ink">
                  {confirmWord}
                </code>{" "}
                below to confirm
              </span>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                placeholder={confirmWord}
                className="h-9 w-full rounded-md border border-status-danger bg-white px-3 text-sm"
              />
              {/* Says why the button is disabled, instead of leaving someone
                  to guess what the box wants. */}
              {typed.trim() !== "" && !satisfied ? (
                <span className="text-xs text-status-danger">
                  That does not match. Type {confirmWord} exactly.
                </span>
              ) : null}
            </label>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <ConfirmSubmit
              label={confirmLabel ?? label}
              pendingLabel={pendingLabel ?? "Working…"}
              blocked={!satisfied}
              variant={variant}
            />
          </div>
        </form>
      </dialog>
    </>
  );
}

function ConfirmSubmit({
  label,
  pendingLabel,
  blocked,
  variant,
}: {
  label: string;
  pendingLabel: string;
  blocked: boolean;
  variant: "destructive" | "secondary";
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      size="sm"
      variant={variant}
      disabled={pending || blocked}
    >
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? pendingLabel : label}
    </Button>
  );
}
