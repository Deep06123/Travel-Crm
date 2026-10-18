"use client";

import { Loader2, Save, Send } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

import { composeMessageAction, type MessageFormState } from "./actions";

function SubmitButton({
  label,
  intent,
  icon,
  variant = "primary",
}: {
  label: string;
  intent: "send" | "draft";
  icon: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      name="intent"
      value={intent}
      variant={variant}
      disabled={pending}
    >
      {pending ? <Loader2 className="animate-spin" /> : icon}
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function ComposeForm({
  recipients,
  groups,
}: {
  recipients: { id: string; name: string; role: string }[];
  groups: { id: string; name: string; memberCount: number }[];
}) {
  const [state, formAction] = useActionState<MessageFormState, FormData>(
    composeMessageAction,
    {},
  );
  const [groupId, setGroupId] = useState("");

  const value = (field: string) => state.values?.[field] ?? "";
  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <p role="alert" className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger">
          {state.error}
        </p>
      ) : null}

      {state.success ? (
        <p role="status" className="rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success">
          {state.success}
        </p>
      ) : null}

      <Field id="msg-subject" label="Subject" required error={error("subject")}>
        {(props) => (
          <Input {...props} name="subject" required defaultValue={value("subject")} />
        )}
      </Field>

      <Field
        id="msg-group"
        label="Send to a group"
        hint="A group expands to its members, so each person gets their own copy."
      >
        {(props) => (
          <Select
            {...props}
            name="groupId"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            <option value="">— No group —</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({group.memberCount} member
                {group.memberCount === 1 ? "" : "s"})
              </option>
            ))}
          </Select>
        )}
      </Field>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">
          Recipients
          {groupId ? (
            <span className="ml-2 text-xs font-normal text-ink-muted">
              Added to the group members above
            </span>
          ) : null}
        </legend>

        <div className="max-h-56 overflow-y-auto rounded-md border border-line p-2">
          {recipients.length === 0 ? (
            <p className="p-2 text-sm text-ink-muted">No other active accounts.</p>
          ) : (
            recipients.map((recipient) => (
              <label
                key={recipient.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-muted"
              >
                <input
                  type="checkbox"
                  name="recipientIds"
                  value={recipient.id}
                  className="size-4 rounded border-line-strong"
                />
                <span className="flex-1">{recipient.name}</span>
                <span className="text-xs text-ink-subtle">{recipient.role}</span>
              </label>
            ))
          )}
        </div>
      </fieldset>

      <Field id="msg-body" label="Message" required error={error("body")}>
        {(props) => (
          <Textarea {...props} name="body" rows={8} required defaultValue={value("body")} />
        )}
      </Field>

      <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-ink-muted">
        This is an internal message between administrators. Sending makes it
        readable in each recipient&rsquo;s inbox here — it does not send an email
        or an SMS, because no provider is configured.
      </p>

      <div className="flex items-center gap-2">
        <SubmitButton label="Send" intent="send" icon={<Send />} />
        <SubmitButton
          label="Save draft"
          intent="draft"
          icon={<Save />}
          variant="secondary"
        />
      </div>
    </form>
  );
}
