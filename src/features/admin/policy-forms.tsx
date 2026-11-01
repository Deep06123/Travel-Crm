"use client";

import { Loader2, RotateCcw, Save } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import type { PolicySectionView } from "@/server/services/email-policy-service";

import {
  savePolicySectionAction,
  type PolicyFormState,
} from "./policy-actions";

/**
 * Editors for the three policy blocks printed at the foot of every customer
 * email.
 *
 * One form per section rather than one for all three: an operator rewriting
 * the change rules should not have to resubmit the other two, and a failure
 * saving one should not take the others down with it.
 */

function Actions({ isCustom }: { isCustom: boolean }) {
  const { pending } = useFormStatus();

  return (
    <div className="flex items-center gap-2">
      <Button type="submit" size="sm" name="intent" value="save" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />}
        {pending ? "Saving…" : "Save wording"}
      </Button>

      {/* Only offered once there is something to undo. Restoring is a delete,
          so it is destructive in the only sense that matters here: the typed
          wording is gone and the code's version takes over. */}
      {isCustom ? (
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          name="intent"
          value="restore"
          disabled={pending}
        >
          <RotateCcw />
          Restore default
        </Button>
      ) : null}
    </div>
  );
}

function Feedback({ state }: { state: PolicyFormState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
      >
        {state.error}
      </p>
    );
  }

  if (state.success) {
    return (
      <p
        role="status"
        className="rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success"
      >
        {state.success}
      </p>
    );
  }

  return null;
}

function SectionEditor({ view }: { view: PolicySectionView }) {
  const [state, formAction] = useActionState<PolicyFormState, FormData>(
    savePolicySectionAction,
    {},
  );

  // Uncontrolled would be simpler, but "Restore default" has to put the
  // built-in wording back in the box without a reload, and `defaultValue`
  // cannot do that.
  const [text, setText] = useState(view.lines.join("\n"));
  const id = `policy-${view.section}`;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="section" value={view.section} />

      <Feedback state={state} />

      <Field
        id={id}
        label={view.heading}
        hint={
          <>
            One bullet per line. {view.lines.length}{" "}
            {view.lines.length === 1 ? "bullet" : "bullets"}
            {view.isCustom ? " · edited" : " · built-in wording"}
          </>
        }
      >
        {(props) => (
          <Textarea
            {...props}
            name="lines"
            rows={Math.min(14, Math.max(6, view.lines.length + 2))}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-40 font-normal"
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Actions isCustom={view.isCustom} />

        {view.isCustom ? (
          <button
            type="button"
            onClick={() => setText(view.defaultLines.join("\n"))}
            className="text-xs text-navy-500 underline-offset-4 hover:underline"
          >
            Put the built-in wording back in the box
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function PolicySectionForms({
  sections,
  canManage,
}: {
  sections: readonly PolicySectionView[];
  canManage: boolean;
}) {
  if (!canManage) {
    return (
      <div className="flex flex-col gap-4">
        {sections.map((view) => (
          <div key={view.section}>
            <h3 className="mb-1.5 text-sm font-semibold text-ink">
              {view.heading}
            </h3>
            <ul className="list-disc pl-5 text-sm text-ink-muted">
              {view.lines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.map((view) => (
        <SectionEditor key={view.section} view={view} />
      ))}
    </div>
  );
}
