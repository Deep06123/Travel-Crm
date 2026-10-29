"use client";

import { Loader2, Plus } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { StickySelect } from "@/components/ui/sticky-select";

import { saveMessageGroupAction, type MessageFormState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Plus />}
      {pending ? "Saving…" : "Create group"}
    </Button>
  );
}

export function MessageGroupForm({
  members,
}: {
  members: { id: string; name: string; role: string }[];
}) {
  const [state, formAction] = useActionState<MessageFormState, FormData>(
    saveMessageGroupAction,
    {},
  );

  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-3">
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

      <Field id="grp-name" label="Group name" required error={error("name")}>
        {(props) => <Input {...props} name="name" required />}
      </Field>

      <Field id="grp-desc" label="Description" error={error("description")}>
        {(props) => <Textarea {...props} name="description" rows={2} />}
      </Field>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">Members</legend>
        <div className="max-h-48 overflow-y-auto rounded-md border border-line p-2">
          {members.map((member) => (
            <label
              key={member.id}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-muted"
            >
              <input
                type="checkbox"
                name="memberIds"
                value={member.id}
                className="size-4 rounded border-line-strong"
              />
              <span className="flex-1">{member.name}</span>
              <span className="text-xs text-ink-subtle">{member.role}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field id="grp-active" label="Active">
        {(props) => (
          <StickySelect {...props} name="isActive" defaultValue="true">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </StickySelect>
        )}
      </Field>

      <p className="text-xs text-ink-muted">
        Members are expanded when a message is sent, so each person gets their
        own copy and their own read state.
      </p>

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
