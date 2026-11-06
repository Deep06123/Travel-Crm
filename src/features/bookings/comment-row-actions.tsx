"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { StickySelect } from "@/components/ui/sticky-select";

import {
  deleteBookingCommentAction,
  updateBookingCommentAction,
  type CommentState,
} from "./comment-actions";

/**
 * Editing and removing a comment, from wherever it is listed.
 *
 * Rendered on the booking's own thread and on the cross-booking list, which
 * is why it takes the comment rather than reading it: both pages already have
 * the row in hand, and a component that re-fetched it would make the list N+1.
 *
 * Whether to render this at all is the caller's decision — it knows who the
 * author is and what the viewer may do. The actions re-check both regardless;
 * hiding a control is a courtesy, not the rule.
 */

export interface EditableComment {
  id: string;
  body: string;
  category: string | null;
  visibility: "INTERNAL" | "CUSTOMER_FACING";
}

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save comment"}
    </Button>
  );
}

function EditDialog({ comment }: { comment: EditableComment }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const [state, formAction] = useActionState<CommentState, FormData>(
    updateBookingCommentAction,
    {},
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Closed on success only: a rejected save has to stay open with its error
  // and whatever the operator had typed.
  //
  // Closes the element rather than setting state, which would be a setState
  // inside an effect. `onClose` below puts `open` back in step, and that runs
  // as an event handler — the same path Escape and the backdrop already take.
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
        className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
      >
        <form action={formAction} className="flex flex-col gap-3 p-5">
          <input type="hidden" name="commentId" value={comment.id} />

          <h2 className="text-base font-semibold text-ink">Edit comment</h2>

          {state.error ? (
            <p
              role="alert"
              className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
            >
              {state.error}
            </p>
          ) : null}

          <Field id={`comment-body-${comment.id}`} label="Comment" required>
            {(props) => (
              <Textarea
                {...props}
                name="body"
                rows={4}
                required
                defaultValue={comment.body}
              />
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`comment-category-${comment.id}`} label="Category">
              {(props) => (
                <Input
                  {...props}
                  name="category"
                  defaultValue={comment.category ?? ""}
                />
              )}
            </Field>

            <Field id={`comment-visibility-${comment.id}`} label="Visibility">
              {(props) => (
                <StickySelect
                  {...props}
                  name="visibility"
                  defaultValue={comment.visibility}
                >
                  <option value="INTERNAL">Internal</option>
                  <option value="CUSTOMER_FACING">Customer-facing</option>
                </StickySelect>
              )}
            </Field>
          </div>

          <p className="text-xs text-ink-muted">
            The previous wording is kept in the audit log. An edited comment is
            still a record of what was said.
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

export function CommentRowActions({ comment }: { comment: EditableComment }) {
  return (
    <div className="flex flex-wrap gap-2">
      <EditDialog comment={comment} />

      <ConfirmButton
        action={deleteBookingCommentAction}
        fields={{ commentId: comment.id }}
        label="Delete"
        pendingLabel="Deleting…"
        icon={<Trash2 />}
        title="Delete this comment"
        confirmLabel="Delete comment"
        description={
          <>
            The comment is removed from the booking. Its text is written to the
            audit log first, so what it said remains answerable — but it will
            not appear on the thread again.
          </>
        }
      />
    </div>
  );
}
