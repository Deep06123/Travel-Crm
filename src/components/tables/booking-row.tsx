import Link from "next/link";
import { Eye, FileText, Mail, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/status-badge";
import { isOverdue } from "@/lib/format";

/**
 * Follow-up state for one booking, as a single badge.
 *
 * The reference CRM shows DON or PEN. The wording here is the application's
 * own, but the question is the same: is anything still owed on this booking.
 *
 * Overdue is called out separately from merely pending. A list that shows both
 * as "pending" hides the only distinction an operator acts on — and the
 * overdue ones are the reason to look at the column at all.
 */
export function FollowUpState({
  followUps,
}: {
  followUps: readonly { id: string; dueAt: Date | null }[];
}) {
  if (followUps.length === 0) {
    return <Badge tone="success">Done</Badge>;
  }

  const overdue = followUps.filter(
    (followUp) => followUp.dueAt !== null && isOverdue(followUp.dueAt),
  ).length;

  if (overdue > 0) {
    return (
      <Badge tone="danger">
        {overdue} overdue
      </Badge>
    );
  }

  return (
    <Badge tone="warning">
      {followUps.length} pending
    </Badge>
  );
}

/**
 * Row-level shortcuts into the booking.
 *
 * Every one is a link to a page that performs its own permission check — none
 * of them mutates anything. That is deliberate: an icon that changes a booking
 * straight from a list, with no confirmation and no reason captured, is how an
 * audit trail ends up recording changes nobody can explain. Actions that write
 * live on the booking itself, where the context to make them sensibly is.
 *
 * `canViewDocuments` only hides a link the documents page would refuse anyway;
 * hiding it saves the operator a pointless click, it is not the control.
 */
export function RowActions({
  bookingId,
  canViewDocuments,
  canSeeETicket,
}: {
  bookingId: string;
  canViewDocuments: boolean;
  /** A cruise is confirmed by the cruise line; there is no air ticket. */
  canSeeETicket: boolean;
}) {
  const iconClass =
    "flex size-7 items-center justify-center rounded text-ink-muted hover:bg-surface-sunken hover:text-navy-500 [&_svg]:size-4";

  return (
    <div className="flex items-center gap-0.5">
      <Link href={`/admin/bookings/${bookingId}`} className={iconClass} title="Open booking">
        <Eye />
        <span className="sr-only">Open booking</span>
      </Link>

      {/* Labelled rather than an icon. It is the action operators reach for
          most from this list, and a ticket glyph beside an eye and an envelope
          is easy to miss. Opens in a new tab so the list stays put.

          One label for every row, matching the reference CRM. A cruise has no
          air ticket, so the word is loose there — the page itself is not, and
          renders the cruise wording with no ticket-number column. The tooltip
          says which document is meant. */}
      <a
        href={`/admin/bookings/${bookingId}/eticket`}
        target="_blank"
        rel="noopener noreferrer"
        title={
          canSeeETicket
            ? "View the e-ticket as the customer receives it"
            : "View the cruise documents as the customer receives them"
        }
        className="inline-flex items-center gap-1 rounded bg-status-info-bg px-2 py-1 text-[11px] font-semibold tracking-wide text-navy-700 uppercase hover:bg-navy-500 hover:text-white [&_svg]:size-3.5"
      >
        <Ticket />
        E-ticket
      </a>

      {canViewDocuments ? (
        <Link
          href={`/admin/documents?bookingId=${bookingId}`}
          className={iconClass}
          title="Documents"
        >
          <FileText />
          <span className="sr-only">Documents</span>
        </Link>
      ) : null}

      {/* The email history lives on the booking page; this jumps to it rather
          than duplicating the panel in a popover. */}
      <Link
        href={`/admin/bookings/${bookingId}#customer-email`}
        className={iconClass}
        title="Customer email"
      >
        <Mail />
        <span className="sr-only">Customer email</span>
      </Link>
    </div>
  );
}
