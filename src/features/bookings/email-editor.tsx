"use client";

import { Loader2, RotateCcw, Send, X } from "lucide-react";
import { useRef } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

/**
 * The email as it would be sent, open for correction.
 *
 * Shared by every panel that offers an "Edit" button — the lifecycle emails,
 * the e-ticket and the authorization — so the three cannot drift into three
 * slightly different editors. Each caller supplies its own hidden fields,
 * because they post to different actions.
 *
 * The body is plain text. A rich editor would imply the operator can control
 * the layout, which they cannot: the surrounding markup is supplied by the
 * server precisely so an edited email cannot arrive malformed.
 */

function SubmitButton({ label }: { label: string }) {
  // Inside the form, so this reads the form's own pending state rather than
  // whatever form happens to enclose the panel.
  const { pending } = useFormStatus();

  // Not disabled when the booking has no recipient: the warning beside it says
  // so, and the action refuses the send itself. A greyed-out button with no
  // explanation attached to it is the thing operators report as a bug.
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Send className="size-4" />
      )}
      {pending ? "Sending…" : label}
    </Button>
  );
}

export function EmailEditor({
  title,
  fieldKey,
  recipient,
  subject,
  body,
  hidden,
  bodyHint,
  note,
  generatedBody,
  submitLabel = "Send this version",
  formId,
  onClose,
  formAction,
}: {
  /** Names the message being edited, e.g. "Preview — tickets issued". */
  title: string;
  /**
   * Resets the fields when the operator previews a different message.
   *
   * Without it React keeps the mounted inputs and their `defaultValue` is
   * ignored, so switching previews would leave the previous wording on screen.
   */
  fieldKey: string;
  /** Empty when the booking has no contact address; nothing could be sent. */
  recipient: string;
  subject: string;
  body: string;
  /** Posted with the edit — which booking, which event, which intent. */
  hidden: Readonly<Record<string, string>>;
  bodyHint?: string | undefined;
  /** Shown above the send button, for anything the operator should know first. */
  note?: React.ReactNode;
  /**
   * The generated wording, where `body` may be something else.
   *
   * Offers a way back to it. The authorization email remembers the last
   * message an operator sent and opens on that, which without this would make
   * one booking's custom wording permanent — the standard message exists only
   * in code, so there is nowhere for an operator to copy it back from.
   *
   * Omitted by callers whose editor always opens on the generated message;
   * nothing is drawn, because there is nothing to restore.
   */
  generatedBody?: string | undefined;
  submitLabel?: string;
  /**
   * Names this form so a control outside it can submit it.
   *
   * The panel's own Send button sits in a separate form — nesting the two
   * would be invalid HTML — and posts no subject or body, so clicking it with
   * the editor open used to send the generated wording and discard whatever
   * the operator had just typed. Pointing that button's `form` attribute here
   * makes the two buttons send the same message, which is what an operator
   * looking at an open editor already assumes.
   */
  formId?: string | undefined;
  onClose: () => void;
  formAction: (payload: FormData) => void;
}) {
  /**
   * Written to directly to restore the generated message.
   *
   * The field is uncontrolled — `defaultValue` and nothing else — so that
   * typing in it does not re-render the panel around it on every keystroke.
   * Restoring therefore sets the DOM value rather than React state, which is
   * the same thing the operator's own typing does.
   */
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  /** Nothing to go back to when the field already holds the generated text. */
  const restorable = generatedBody !== undefined && generatedBody !== body;

  return (
    <form
      {...(formId ? { id: formId } : {})}
      action={formAction}
      className="flex flex-col gap-3 rounded-md border border-line bg-surface-muted p-3"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{title}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="size-4" />
          Close
        </Button>
      </div>

      <p className="text-xs text-ink-muted">
        To: {recipient || "— no contact address on this booking —"}
      </p>

      <Field id={`email-subject-${fieldKey}`} label="Subject" required>
        {(props) => (
          <Input
            {...props}
            key={`subject-${fieldKey}`}
            name="subject"
            required
            maxLength={200}
            defaultValue={subject}
          />
        )}
      </Field>

      <Field
        id={`email-body-${fieldKey}`}
        label="Message"
        required
        hint={bodyHint ?? "Plain text. Leave a blank line between paragraphs."}
      >
        {(props) => (
          <Textarea
            {...props}
            ref={bodyRef}
            key={`body-${fieldKey}`}
            name="body"
            rows={14}
            required
            className="font-mono text-xs"
            defaultValue={body}
          />
        )}
      </Field>

      {note}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton label={submitLabel} />

        {/* Fills the field in rather than sending anything: the operator reads
            the standard wording back, and still chooses whether it goes. */}
        {restorable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (bodyRef.current) bodyRef.current.value = generatedBody;
            }}
          >
            <RotateCcw className="size-4" />
            Use the generated message
          </Button>
        ) : null}

        {recipient ? null : (
          <span className="text-xs text-status-warning">
            Add a contact email to the booking before sending.
          </span>
        )}
      </div>
    </form>
  );
}
