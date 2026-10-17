"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { changePasswordAction, type FormState } from "@/features/auth/actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Saving…" : "Change password"}
    </Button>
  );
}

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    changePasswordAction,
    {},
  );

  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-1 text-xl font-semibold text-ink">Change your password</h1>
      <p className="mb-5 text-sm text-ink-muted">
        {forced
          ? "This account was provisioned with a temporary password. Choose your own to continue."
          : "You will be signed out of every device once the change is saved."}
      </p>

      <div className="rounded-lg border border-line bg-white p-6 shadow-sm">
        {state.error ? (
          <p
            role="alert"
            className="mb-4 rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
          >
            {state.error}
          </p>
        ) : null}

        <form action={formAction} className="flex flex-col gap-4">
          <Field
            id="currentPassword"
            label="Current password"
            required
            error={state.fieldErrors?.["currentPassword"]}
          >
            {(controlProps) => (
              <Input
                {...controlProps}
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            )}
          </Field>

          <Field
            id="newPassword"
            label="New password"
            required
            hint="At least 12 characters."
            error={state.fieldErrors?.["newPassword"]}
          >
            {(controlProps) => (
              <Input
                {...controlProps}
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
              />
            )}
          </Field>

          <Field
            id="confirmPassword"
            label="Confirm new password"
            required
            error={state.fieldErrors?.["confirmPassword"]}
          >
            {(controlProps) => (
              <Input
                {...controlProps}
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
              />
            )}
          </Field>

          <SubmitButton />
        </form>
      </div>
    </div>
  );
}
