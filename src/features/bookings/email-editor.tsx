"use client";

import { Loader2, Send, X } from "lucide-react";
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
  submitLabel = "Send this version",
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
  submitLabel?: string;
  onClose: () => void;
  formAction: (payload: FormData) => void;
}) {
  return (
    <form
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

      <div className="flex items-center gap-2">
        <SubmitButton label={submitLabel} />

        {recipient ? null : (
          <span className="text-xs text-status-warning">
            Add a contact email to the booking before sending.
          </span>
        )}
      </div>
    </form>
  );
}
