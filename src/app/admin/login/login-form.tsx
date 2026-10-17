"use client";

import { Loader2, PlaneTakeoff } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { loginAction, type FormState } from "@/features/auth/actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm({
  next,
  passwordChanged,
}: {
  next?: string | undefined;
  passwordChanged: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    loginAction,
    {},
  );

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center gap-2">
        <PlaneTakeoff className="size-9 text-navy-500" />
        <span className="text-2xl font-bold tracking-tight text-navy-500">
          Travel<span className="text-amber-accent-dark">CRM</span>
        </span>
        <p className="text-sm text-ink-muted">Administrator sign in</p>
      </div>

      <div className="rounded-lg border border-line bg-white p-6 shadow-sm">
        {passwordChanged ? (
          <p
            role="status"
            className="mb-4 rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success"
          >
            Your password was changed. Sign in again to continue.
          </p>
        ) : null}

        {state.error ? (
          <p
            role="alert"
            className="mb-4 rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
          >
            {state.error}
          </p>
        ) : null}

        <form action={formAction} className="flex flex-col gap-4">
          {next ? <input type="hidden" name="next" value={next} /> : null}

          <Field
            id="identifier"
            label="Email or username"
            required
            error={state.fieldErrors?.["identifier"]}
          >
            {(controlProps) => (
              <Input
                {...controlProps}
                name="identifier"
                type="text"
                autoComplete="username"
                autoFocus
                required
              />
            )}
          </Field>

          <Field
            id="password"
            label="Password"
            required
            error={state.fieldErrors?.["password"]}
          >
            {(controlProps) => (
              <Input
                {...controlProps}
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            )}
          </Field>

          <SubmitButton />
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-ink-subtle">
        Access is logged. Contact a super administrator if you are locked out.
      </p>
    </div>
  );
}
