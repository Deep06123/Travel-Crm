"use client";

import { Loader2, Save } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";

import {
  saveNotificationEmailsAction,
  type NotificationFormState,
} from "./notification-actions";

/**
 * Who gets the internal copy of a customer email.
 *
 * A textarea rather than a single input because a business rarely has one
 * address for this: there is the owner, and then there is whoever covers the
 * desk at the weekend. One per line, and commas are accepted too — the list is
 * normalised on save, so what comes back is what will actually be emailed.
 */

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Save />}
      {pending ? "Saving…" : "Save addresses"}
    </Button>
  );
}

export function NotificationRecipientsForm({
  addresses,
}: {
  addresses: readonly string[];
}) {
  const [state, formAction] = useActionState<NotificationFormState, FormData>(
    saveNotificationEmailsAction,
    {},
  );

  // Uncontrolled would do until a save normalises the list — dropping a
  // duplicate, trimming a stray space — and the box has to show what was
  // actually stored rather than what was typed. `defaultValue` cannot do that.
  const [text, setText] = useState(addresses.join("\n"));
  const stored = state.addresses ?? addresses;

  return (
    <form action={formAction} className="flex flex-col gap-3">
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

      <Field
        id="admin-notification-emails"
        label="Notification addresses"
        hint={
          stored.length === 0
            ? "Empty — no internal copies are being sent."
            : `${stored.length} ${stored.length === 1 ? "address" : "addresses"} · one per line, or separated by commas`
        }
      >
        {(props) => (
          <Textarea
            {...props}
            name="addresses"
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="owner@example.com"
            className="font-normal"
          />
        )}
      </Field>

      <div>
        <SaveButton />
      </div>
    </form>
  );
}
