"use client";

import { Trash2 } from "lucide-react";

import { ConfirmButton } from "@/components/ui/confirm-button";

import { deleteAuditEntryAction } from "./settings-actions";

/**
 * Deleting one audit entry.
 *
 * There is no Edit here, and that is deliberate: an audit entry that can be
 * rewritten is not evidence of anything. Deletion is offered because it was
 * asked for; the dialog says plainly what it costs rather than dressing it up
 * as routine tidying.
 *
 * The typed confirmation is DELETE rather than something drawn from the row,
 * because an entry has no name — and typing a word you had to read first is
 * the only friction available on a control this cheap to click.
 */
export function AuditRowActions({
  entryId,
  summary,
}: {
  entryId: string;
  /** Shown back so the operator sees what they are removing. */
  summary: string;
}) {
  return (
    <ConfirmButton
      action={deleteAuditEntryAction}
      fields={{ id: entryId }}
      label="Delete"
      pendingLabel="Deleting…"
      icon={<Trash2 />}
      title="Delete this audit entry"
      confirmLabel="Delete the entry"
      confirmWord="DELETE"
      description={
        <>
          <p className="mb-2 rounded-md bg-surface-sunken px-3 py-2 text-xs text-ink">
            {summary}
          </p>
          <p className="mb-2">
            The audit log is what answers &ldquo;who authorised this&rdquo;
            months later, to someone not inclined to take our word for it.
            Removing an entry removes that answer.
          </p>
          <p>
            The deletion is itself written to the log, carrying this entry&rsquo;s
            summary, actor and time — so this leaves a visible scar rather than
            a silent hole.
          </p>
        </>
      }
    />
  );
}
