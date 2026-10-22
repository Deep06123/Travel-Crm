"use client";

import { Loader2, PlaneTakeoff } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  demoSignInAction,
  loginAction,
  type FormState,
} from "@/features/auth/actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

function SkipButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="secondary"
      className="w-full"
      size="lg"
      disabled={pending}
    >
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Opening…" : "Skip sign-in and explore"}
    </Button>
  );
}

export function LoginForm({
  next,
  passwordChanged,
  demoMode,
}: {
  next?: string | undefined;
  passwordChanged: boolean;
  /** Resolved on the server; the browser never decides whether this is on. */
  demoMode: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    loginAction,
    {},
  );

  const [demoState, demoFormAction] = useActionState<FormState, FormData>(
    async () => (await demoSignInAction()) ?? {},
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

        {state.error || demoState.error ? (
          <p
            role="alert"
            className="mb-4 rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
          >
            {state.error ?? demoState.error}
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

        {demoMode ? (
          <>
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="text-xs text-ink-subtle">or</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            {/* A separate form: the credential fields are `required`, and
                submitting them empty to reach this action would trip the
                browser's own validation before the request left the page. */}
            <form action={demoFormAction}>
              <SkipButton />
            </form>

            <p className="mt-3 text-center text-xs text-ink-subtle">
              Opens the full application as a demo administrator. No sign-in,
              and the data is shared with everyone who has this link.
            </p>
          </>
        ) : null}
      </div>

      <p className="mt-4 text-center text-xs text-ink-subtle">
        Access is logged. Contact a super administrator if you are locked out.
      </p>
    </div>
  );
}
