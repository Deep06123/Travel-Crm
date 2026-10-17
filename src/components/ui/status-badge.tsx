import type { ReactNode } from "react";

import type {
  BookingPriority,
  BookingStatus,
  ChargebackStatus,
  FollowUpStatus,
  McoStatus,
  PaymentStatus,
  RefundStatus,
  TicketStatus,
} from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * Status presentation.
 *
 * Booking, ticketing, payment and refund states are deliberately rendered with
 * the same small vocabulary of tones, so "green" means settled and "red" means
 * failed or lost no matter which column it appears in. A booking that is
 * cancelled but holds a completed payment and a pending refund shows three
 * different badges — the states are separate and are never collapsed into one.
 */

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const toneClasses: Record<Tone, string> = {
  success: "bg-status-success-bg text-status-success",
  warning: "bg-status-warning-bg text-status-warning",
  danger: "bg-status-danger-bg text-status-danger",
  info: "bg-status-info-bg text-status-info",
  neutral: "bg-status-neutral-bg text-status-neutral",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

interface Presentation {
  label: string;
  tone: Tone;
}

const bookingStatus: Record<BookingStatus, Presentation> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PENDING: { label: "Pending", tone: "warning" },
  NEEDS_REVIEW: { label: "Needs Review", tone: "warning" },
  CONFIRMED: { label: "Confirmed", tone: "success" },
  TICKETED: { label: "Ticketed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
  COMPLETED: { label: "Completed", tone: "info" },
};

const ticketStatus: Record<TicketStatus, Presentation> = {
  NOT_APPLICABLE: { label: "N/A", tone: "neutral" },
  PENDING: { label: "Pending", tone: "warning" },
  IN_PROGRESS: { label: "In Progress", tone: "info" },
  ISSUED: { label: "Issued", tone: "success" },
  VOIDED: { label: "Voided", tone: "danger" },
  EXCHANGED: { label: "Exchanged", tone: "info" },
  FAILED: { label: "Failed", tone: "danger" },
};

const mcoStatus: Record<McoStatus, Presentation> = {
  NOT_APPLICABLE: { label: "N/A", tone: "neutral" },
  PENDING: { label: "Pending", tone: "warning" },
  SUBMITTED: { label: "Submitted", tone: "info" },
  CONFIRMED: { label: "Confirmed", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

const paymentStatus: Record<PaymentStatus, Presentation> = {
  PENDING: { label: "Pending", tone: "warning" },
  AUTHORIZED: { label: "Authorized", tone: "info" },
  CAPTURED: { label: "Captured", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "info" },
  PARTIALLY_REFUNDED: { label: "Partly Refunded", tone: "info" },
};

const refundStatus: Record<RefundStatus, Presentation> = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "info" },
  REJECTED: { label: "Rejected", tone: "danger" },
  PROCESSING: { label: "Processing", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
};

const chargebackStatus: Record<ChargebackStatus, Presentation> = {
  RECEIVED: { label: "Received", tone: "warning" },
  EVIDENCE_REQUIRED: { label: "Evidence Required", tone: "warning" },
  EVIDENCE_SUBMITTED: { label: "Evidence Submitted", tone: "info" },
  UNDER_REVIEW: { label: "Under Review", tone: "info" },
  WON: { label: "Won", tone: "success" },
  LOST: { label: "Lost", tone: "danger" },
  ACCEPTED: { label: "Accepted", tone: "neutral" },
};

const followUpStatus: Record<FollowUpStatus, Presentation> = {
  OPEN: { label: "Open", tone: "warning" },
  IN_PROGRESS: { label: "In Progress", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

const priority: Record<BookingPriority, Presentation> = {
  LOW: { label: "Low", tone: "neutral" },
  NORMAL: { label: "Normal", tone: "neutral" },
  HIGH: { label: "High", tone: "warning" },
  URGENT: { label: "Urgent", tone: "danger" },
};

function render(presentation: Presentation) {
  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}

export const BookingStatusBadge = ({ status }: { status: BookingStatus }) =>
  render(bookingStatus[status]);

export const TicketStatusBadge = ({ status }: { status: TicketStatus }) =>
  render(ticketStatus[status]);

export const McoStatusBadge = ({ status }: { status: McoStatus }) =>
  render(mcoStatus[status]);

export const PaymentStatusBadge = ({ status }: { status: PaymentStatus }) =>
  render(paymentStatus[status]);

export const RefundStatusBadge = ({ status }: { status: RefundStatus }) =>
  render(refundStatus[status]);

export const ChargebackStatusBadge = ({ status }: { status: ChargebackStatus }) =>
  render(chargebackStatus[status]);

export const FollowUpStatusBadge = ({ status }: { status: FollowUpStatus }) =>
  render(followUpStatus[status]);

export const PriorityBadge = ({ level }: { level: BookingPriority }) =>
  render(priority[level]);

/** Plain-text labels, for CSV exports and page titles. */
export const STATUS_LABELS = {
  booking: bookingStatus,
  ticket: ticketStatus,
  mco: mcoStatus,
  payment: paymentStatus,
  refund: refundStatus,
  chargeback: chargebackStatus,
  followUp: followUpStatus,
  priority,
} as const;
