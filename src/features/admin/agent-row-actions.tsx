"use client";

import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";

import { removeAgentAction } from "./agent-actions";

/**
 * Edit and delete, in the last column of the agent list.
 *
 * Edit links to the agent page, which already holds the whole account — role,
 * team, dialer id, IP allowlist, password reset. A dialog would be a second
 * copy of a form that is genuinely large.
 *
 * Delete removes the account outright, whatever it has done. Every foreign key
 * pointing at an administrator is `SetNull`, so bookings, refunds and
 * authorizations they touched survive with their attribution cleared — the
 * confirmation says so, because it cannot be undone.
 */
export function AgentRowActions({
  agentId,
  name,
  isSelf,
}: {
  agentId: string;
  /** Shown in the confirmation, and typed back to delete. */
  name: string;
  /** Your own row: removing it would sign you out mid-request. */
  isSelf: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Link
        href={`/admin/agents/${agentId}`}
        className={buttonVariants({ variant: "secondary", size: "sm" })}
      >
        <Pencil />
        Edit
      </Link>

      {isSelf ? (
        <span className="text-xs text-ink-subtle">Your account</span>
      ) : (
        <ConfirmButton
          action={removeAgentAction}
          fields={{ agentId }}
          label="Delete"
          pendingLabel="Deleting…"
          icon={<Trash2 />}
          title={`Delete ${name}`}
          confirmLabel="Delete for good"
          confirmWord={name}
          description={
            <>
              The account is removed permanently and every live session for it
              ends. Anything recorded against it — bookings, refunds,
              authorizations, comments — is kept but will no longer name
              anyone. This cannot be undone.
            </>
          }
        />
      )}
    </div>
  );
}
