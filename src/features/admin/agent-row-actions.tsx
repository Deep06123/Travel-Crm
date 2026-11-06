"use client";

import { Pencil, PowerOff, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";

import { reactivateAgentAction, removeAgentAction } from "./agent-actions";

/**
 * Edit and remove, in the last column of the agent list.
 *
 * Edit links to the agent page, which already holds the whole account — role,
 * team, dialer id, IP allowlist, password reset. A dialog would be a second
 * copy of a form that is genuinely large.
 *
 * Remove is deliberately conservative. Every foreign key pointing at an
 * administrator is `SetNull`, so the database *would* delete one and silently
 * reattribute their bookings, refunds and signatures to nobody. So an account
 * that has acted can only be deactivated — which signs them out immediately
 * and keeps the record whole — and only a never-used account can be deleted.
 *
 * The server decides for real; this just picks which control to draw.
 */
export function AgentRowActions({
  agentId,
  name,
  status,
  hasActivity,
  isSelf,
}: {
  agentId: string;
  /** Shown in the confirmation, and typed back to delete. */
  name: string;
  status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
  /**
   * Whether the account has ever done anything — signed in, created a
   * booking, left a comment. The server counts properly across seven
   * relations; this is the cheap signal for which button belongs here.
   */
  hasActivity: boolean;
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
      ) : !hasActivity ? (
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
              This account has never signed in and has nothing recorded against
              it, so it can be removed outright. This cannot be undone — only
              the audit entry remains.
            </>
          }
        />
      ) : status === "ACTIVE" ? (
        <ConfirmButton
          action={removeAgentAction}
          fields={{ agentId, deactivate: "true" }}
          label="Deactivate"
          pendingLabel="Deactivating…"
          icon={<PowerOff />}
          variant="secondary"
          title={`Deactivate ${name}`}
          confirmLabel="Deactivate account"
          description={
            <>
              They are signed out immediately and cannot sign back in. The
              account is kept because bookings, refunds and authorizations are
              attributed to it — deleting it would leave all of that recorded
              against nobody.
            </>
          }
        />
      ) : (
        <ConfirmButton
          action={reactivateAgentAction}
          fields={{ agentId }}
          label="Reactivate"
          pendingLabel="Reactivating…"
          icon={<RotateCcw />}
          variant="secondary"
          title={`Reactivate ${name}`}
          confirmLabel="Reactivate"
          description={
            <>
              The account can sign in again with its existing password. Reset
              it from the agent page if the account was suspended for a
              security reason.
            </>
          }
        />
      )}
    </div>
  );
}
