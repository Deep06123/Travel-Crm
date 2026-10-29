"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { StickySelect } from "@/components/ui/sticky-select";
import { BookingPriority, CommentVisibility } from "@/generated/prisma/enums";

import {
  addBookingCommentAction,
  createFollowUpAction,
  type CommentState,
} from "./comment-actions";

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Feedback({ state }: { state: CommentState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger">
        {state.error}
      </p>
    );
  }

  if (state.success) {
    return (
      <p role="status" className="rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success">
        {state.success}
      </p>
    );
  }

  return null;
}

export function CommentForm({ bookingId }: { bookingId: string }) {
  const [state, formAction] = useActionState<CommentState, FormData>(
    addBookingCommentAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <Feedback state={state} />

      <Field id="comment-body" label="Comment" required>
        {(props) => (
          <Textarea {...props} name="body" rows={3} required placeholder="Add a note…" />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          id="comment-visibility"
          label="Visibility"
          hint="Internal notes are never shown to the customer."
        >
          {(props) => (
            <StickySelect {...props} name="visibility" defaultValue={CommentVisibility.INTERNAL}>
              <option value={CommentVisibility.INTERNAL}>Internal note</option>
              <option value={CommentVisibility.CUSTOMER_FACING}>Customer-facing</option>
            </StickySelect>
          )}
        </Field>

        <Field id="comment-category" label="Category">
          {(props) => <Input {...props} name="category" placeholder="Optional" />}
        </Field>

        <Field id="comment-followUpAt" label="Follow-up date">
          {(props) => <Input {...props} name="followUpAt" type="date" />}
        </Field>
      </div>

      <div>
        <SubmitButton label="Add comment" />
      </div>
    </form>
  );
}

export function FollowUpForm({
  bookingId,
  agents,
}: {
  bookingId: string;
  agents: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState<CommentState, FormData>(
    createFollowUpAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <Feedback state={state} />

      <Field id="followup-reason" label="Reason" required>
        {(props) => (
          <Input {...props} name="reason" required placeholder="What needs chasing?" />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="followup-dueAt" label="Due date" required>
          {(props) => <Input {...props} name="dueAt" type="date" required />}
        </Field>

        <Field id="followup-priority" label="Priority">
          {(props) => (
            <StickySelect {...props} name="priority" defaultValue={BookingPriority.NORMAL}>
              {Object.values(BookingPriority).map((level) => (
                <option key={level} value={level}>
                  {humanise(level)}
                </option>
              ))}
            </StickySelect>
          )}
        </Field>

        <Field id="followup-assigneeId" label="Assign to">
          {(props) => (
            <StickySelect {...props} name="assigneeId" defaultValue="">
              <option value="">— Unassigned —</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </StickySelect>
          )}
        </Field>
      </div>

      <div>
        <SubmitButton label="Create follow-up" />
      </div>
    </form>
  );
}
