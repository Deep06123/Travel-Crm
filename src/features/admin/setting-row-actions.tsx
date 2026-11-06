"use client";

import { Pencil, RotateCcw } from "lucide-react";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, Input, Textarea } from "@/components/ui/field";

import {
  resetBusinessSettingAction,
  saveBusinessSettingAction,
  type SettingActionState,
} from "./settings-actions";

/**
 * Editing one business setting, from the row it is displayed in.
 *
 * The values are heterogeneous — a number, a currency code, a list of MIME
 * types — so the field is chosen from the declared kind rather than being a
 * single JSON textarea. A textarea would accept `{"nope": true}` and leave a
 * reader somewhere to discover it.
 *
 * Restore puts the row back to the built-in default by deleting it. That is
 * not destructive here: every reader falls back to a constant when the row is
 * missing, and the seed recreates it on the next deploy without overwriting
 * an edited value.
 */

export interface EditableSetting {
  key: string;
  label: string;
  hint: string;
  kind: "text" | "integer" | "list";
  /** The stored value, already flattened for a form field. */
  inputValue: string;
  /** False once the row is gone, which is the built-in default. */
  isStored: boolean;
}

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

function EditDialog({ setting }: { setting: EditableSetting }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const [state, formAction] = useActionState<SettingActionState, FormData>(
    saveBusinessSettingAction,
    {},
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Closes the element, not the state: `onClose` syncs `open` back as an
  // event, which keeps this out of setState-inside-an-effect territory.
  useEffect(() => {
    if (state.success) dialogRef.current?.close();
  }, [state.success]);

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
        onClose={close}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
      >
        <form action={formAction} className="flex flex-col gap-3 p-5">
          <input type="hidden" name="key" value={setting.key} />

          <h2 className="text-base font-semibold text-ink">{setting.label}</h2>

          {state.error ? (
            <p
              role="alert"
              className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
            >
              {state.error}
            </p>
          ) : null}

          <Field
            id={`setting-${setting.key}`}
            label="Value"
            hint={setting.hint}
            required
          >
            {(props) =>
              setting.kind === "list" ? (
                <Textarea
                  {...props}
                  name="value"
                  rows={3}
                  required
                  defaultValue={setting.inputValue}
                />
              ) : (
                <Input
                  {...props}
                  name="value"
                  required
                  // `inputMode` rather than `type="number"`: a spinner on a
                  // byte count is noise, and the server parses it anyway.
                  {...(setting.kind === "integer"
                    ? { inputMode: "numeric" as const }
                    : {})}
                  defaultValue={setting.inputValue}
                />
              )
            }
          </Field>

          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <SaveButton />
          </div>
        </form>
      </dialog>
    </>
  );
}

export function SettingRowActions({ setting }: { setting: EditableSetting }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <EditDialog setting={setting} />

      {setting.isStored ? (
        <ConfirmButton
          action={resetBusinessSettingAction}
          fields={{ key: setting.key }}
          label="Restore default"
          pendingLabel="Restoring…"
          icon={<RotateCcw />}
          variant="secondary"
          title={`Restore ${setting.label.toLowerCase()}`}
          confirmLabel="Restore the default"
          description={
            <>
              Removes the stored value so the built-in default applies again.
              Nothing breaks in the meantime: every reader falls back to a
              constant when this setting is absent.
            </>
          }
        />
      ) : null}
    </div>
  );
}
