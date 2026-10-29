"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { RichTextEditor } from "@/components/ui/rich-text-editor";

/**
 * The two ways an itinerary gets into a booking.
 *
 * Either the agent pastes the carrier's own record — a PNR for a flight, a
 * reservation for a cruise — or they compose it by hand in the editor. Both
 * are kept: they are different evidence, not two spellings of the same thing,
 * and a booking may reasonably carry one, the other, or both.
 *
 * Neither is parsed. The raw text is stored exactly as pasted, which is what
 * makes it worth keeping as a record of what the carrier actually said.
 */
/** What the decode button says, and what it admits when pressed. */
const DEFAULT_ACTION_LABEL = "Decode PNR using API";
const DEFAULT_ACTION_NOTICE =
  "No PNR decoding integration is configured. What you pasted has been kept exactly as typed — fill in the segments below by hand.";

export function ItinerarySource({
  textName,
  textLabel,
  textPlaceholder,
  textHint,
  textError,
  htmlName,
  defaultText,
  defaultHtml,
  actionLabel = DEFAULT_ACTION_LABEL,
  actionNotice = DEFAULT_ACTION_NOTICE,
}: {
  textName: string;
  textLabel: string;
  textPlaceholder: string;
  textHint: string;
  textError?: string | undefined;
  htmlName: string;
  defaultText?: string | undefined;
  defaultHtml?: string | undefined;
  /** A cruise has no PNR, so both the button and its answer are overridable. */
  actionLabel?: string;
  actionNotice?: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="mt-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <Field
            id={textName}
            label={textLabel}
            hint={textHint}
            error={textError}
          >
            {(props) => (
              <Textarea
                {...props}
                name={textName}
                rows={6}
                className="font-mono text-xs"
                placeholder={textPlaceholder}
                defaultValue={defaultText}
              />
            )}
          </Field>
        </div>

        <div className="flex shrink-0 flex-col gap-2 lg:pt-7">
          <Button
            type="button"
            variant="primary"
            className="bg-status-success hover:brightness-110"
            // There is no decoder. Saying so on demand is the honest
            // behaviour: the alternative is a control that looks like it did
            // something and an agent who believes the fields below were
            // filled in for them.
            onClick={() => setNotice(actionNotice)}
          >
            {actionLabel}
          </Button>
        </div>
      </div>

      {notice ? (
        <p
          role="status"
          className="mt-2 flex items-start gap-2 rounded-md bg-status-warning-bg px-3 py-2 text-xs text-status-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {notice}
        </p>
      ) : null}

      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-sm font-bold text-status-danger">OR</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <Field
        id={htmlName}
        label="Itinerary"
        hint="Compose the itinerary by hand when there is no record to paste. Screenshots can be pasted, dropped or added with the image button. Formatting is kept; scripts, embedded frames and images from other sites are removed when saved."
      >
        {() => (
          <RichTextEditor
            name={htmlName}
            defaultValue={defaultHtml}
            placeholder="Type or paste the itinerary…"
          />
        )}
      </Field>
    </div>
  );
}
