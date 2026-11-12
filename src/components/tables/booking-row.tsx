import Link from "next/link";
import { Download, Eye, FileText, Mail, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/status-badge";
import { DeleteBookingButton } from "@/features/bookings/delete-booking-button";
import type {
  AuthorizationState,
  AuthorizationSummary,
} from "@/lib/bookings/authorization-state";
import { formatDate } from "@/lib/format";

/**
 * How far the authorization email has got, as one badge and one date.
 *
 * This column replaced the follow-up one. A follow-up count restated what the
 * Booked column was already saying in words, while the question an operator
 * actually works this list for — has this customer authorized the charge, and
 * if not, have we even asked — was not on the screen at all.
 *
 * The badge carries the state and the line beneath carries when, because
 * "Pending" means something quite different under a date from this morning
 * than under one from three weeks ago, and only one of those is worth chasing.
 */
const AUTHORIZATION_PRESENTATION: Record<
  AuthorizationState,
  { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral"; prefix: string }
> = {
  // Neutral rather than alarming. Plenty of bookings legitimately have not
  // reached the point of asking yet, and a red badge on every one of them
  // would train people to ignore the column.
  NOT_SENT: { label: "Not sent", tone: "neutral", prefix: "" },
  SENT: { label: "Pending", tone: "warning", prefix: "Sent" },
  // Distinct from merely sent: the customer has the link and has looked at it.
  // That is a different conversation from one who never opened the email.
  VIEWED: { label: "Opened", tone: "info", prefix: "Opened" },
  SIGNED: { label: "Confirmed", tone: "success", prefix: "Signed" },
  EXPIRED: { label: "Expired", tone: "danger", prefix: "Expired" },
};

export function AuthEmailState({ summary }: { summary: AuthorizationSummary }) {
  const presentation = AUTHORIZATION_PRESENTATION[summary.state];

  return (
    <div>
      <Badge tone={presentation.tone}>{presentation.label}</Badge>
      {summary.at ? (
        <div className="mt-0.5 text-xs whitespace-nowrap text-ink-muted">
          {presentation.prefix} {formatDate(summary.at)}
        </div>
      ) : (
        <div className="mt-0.5 text-xs text-ink-subtle">No email yet</div>
      )}
    </div>
  );
}

/**
 * Row-level shortcuts into the booking.
 *
 * All but one are links to a page that performs its own permission check, and
 * none of those mutates anything. That is deliberate: an icon that changes a
 * booking straight from a list, with no confirmation and no reason captured,
 * is how an audit trail ends up recording changes nobody can explain. Actions
 * that write live on the booking itself, where the context to make them
 * sensibly is.
 *
 * Delete is the exception, and it keeps the condition that rule was protecting
 * rather than waiving it: it opens a dialog that demands a written reason and
 * the booking number typed back, so nothing is destroyed by a misplaced click.
 *
 * `canViewDocuments` only hides a link the documents page would refuse anyway;
 * hiding it saves the operator a pointless click, it is not the control.
 * `canDelete` is the same — the action re-checks the permission.
 */
export function RowActions({
  bookingId,
  bookingNumber,
  canViewDocuments,
  canSeeETicket,
  canDelete,
  canDownloadAuthorization,
  authorizationSigned,
}: {
  bookingId: string;
  /** Shown in the delete dialog and typed back to confirm. */
  bookingNumber: string;
  canViewDocuments: boolean;
  /** A cruise is confirmed by the cruise line; there is no air ticket. */
  canSeeETicket: boolean;
  canDelete: boolean;
  /** `booking.signature.send` — the same trust the email itself takes. */
  canDownloadAuthorization: boolean;
  /**
   * Whether this booking has a signed authorization.
   *
   * Only changes what the tooltip promises. The route decides what it actually
   * serves by re-reading the booking, so a stale page cannot talk it into
   * handing over evidence that does not exist.
   */
  authorizationSigned: boolean;
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

      {/* The authorization, as a file.
          Once signed that is the signed PDF with the captured evidence —
          until this there was no way at all to get it out of the system except
          as an attachment on the email it was sent in, which made producing it
          for a chargeback a hunt through a mailbox.
          Before signing it is the email itself, so an agent can forward or
          keep a copy of exactly what the customer was asked to agree to.
          A plain link, not a fetch: the browser's own download handling is
          what makes Content-Disposition work. */}
      {canDownloadAuthorization ? (
        <a
          href={`/api/admin/bookings/${bookingId}/authorization/download`}
          download
          className={iconClass}
          title={
            authorizationSigned
              ? "Download the signed authorization (PDF)"
              : "Download the authorization email — not signed yet"
          }
        >
          <Download />
          <span className="sr-only">Download authorization</span>
        </a>
      ) : null}

      {/* Last, and visually separated from the four read-only icons, so the
          destructive one is not the neighbour of the one beside it. */}
      {canDelete ? (
        <span className="ml-1 border-l border-line pl-1">
          <DeleteBookingButton
            bookingId={bookingId}
            bookingNumber={bookingNumber}
          />
        </span>
      ) : null}
    </div>
  );
}
