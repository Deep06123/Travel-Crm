"use client";

import { Pencil } from "lucide-react";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

import {
  updateOwnProfileAction,
  type ProfileFormState,
} from "./profile-actions";

/**
 * Editing your own name and phone number from the profile page.
 *
 * Only those two. Role, status, email and username are administrator-set, and
 * the panel says so underneath — an account that can change its own role is
 * not access control, and changing your own email is a password-reset path.
 *
 * In the panel header rather than as fields in the page, because this is read
 * far more often than it is changed: the profile is where people go to check
 * what their account is, not to edit it.
 */
function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function EditProfileButton({
  name,
  phone,
}: {
  name: string;
  phone: string | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const [state, formAction] = useActionState<ProfileFormState, FormData>(
    updateOwnProfileAction,
    {},
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Closes the element; `onClose` syncs the state back as an event handler.
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
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
      >
        <form action={formAction} className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-semibold text-ink">Edit your details</h2>

          {state.error ? (
            <p
              role="alert"
              className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
            >
              {state.error}
            </p>
          ) : null}

          <Field id="profile-name" label="Name" required>
            {(props) => (
              <Input {...props} name="name" required defaultValue={name} />
            )}
          </Field>

          <Field
            id="profile-phone"
            label="Phone"
            hint="Optional. Shown to colleagues on the agents screen."
          >
            {(props) => (
              <Input
                {...props}
                name="phone"
                type="tel"
                defaultValue={phone ?? ""}
              />
            )}
          </Field>

          <p className="text-xs text-ink-muted">
            Your role, status, email and username are set by an administrator.
            Ask one of them if any of those are wrong.
          </p>

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
