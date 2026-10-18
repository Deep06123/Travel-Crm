"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  PaymentMethod,
  PaymentStatus,
  ReconciliationStatus,
  RefundKind,
} from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/dal";
import { RefundExceedsCollectedError } from "@/lib/financial/booking-balance";
import { parseAmountToMinor } from "@/lib/financial/money";
import {
  ApprovalThresholdError,
  InvalidRefundTransitionError,
  SelfApprovalError,
} from "@/lib/financial/refund-rules";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/db/prisma";
import {
  DuplicatePaymentError,
  PaymentCurrencyMismatchError,
  recordPayment,
  setReconciliationStatus,
} from "@/server/services/payment-service";
import {
  approveRefund,
  completeRefundManually,
  rejectRefund,
  requestRefund,
} from "@/server/services/refund-service";

const log = loggerFor("finance-actions");

export interface FinanceFormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Errors whose message is written for the operator and safe to show.
 *
 * Everything else is logged and reported generically, so an internal detail
 * never reaches the browser.
 */
function operatorMessage(error: unknown): string | null {
  if (
    error instanceof RefundExceedsCollectedError ||
    error instanceof ApprovalThresholdError ||
    error instanceof SelfApprovalError ||
    error instanceof InvalidRefundTransitionError ||
    error instanceof DuplicatePaymentError ||
    error instanceof PaymentCurrencyMismatchError
  ) {
    return error.message;
  }

  return null;
}

// --- Payments ---------------------------------------------------------------

const recordPaymentSchema = z.object({
  bookingId: z.string().trim().min(1),
  amount: z.string().trim().min(1, "Enter an amount."),
  method: z.enum(PaymentMethod),
  status: z.enum(PaymentStatus),
  provider: z.string().trim().max(60).optional(),
  providerTransactionId: z.string().trim().max(200).optional(),
  paymentUrl: z.string().trim().max(2_000).optional(),
  cardLast4: z
    .string()
    .trim()
    .max(4)
    .refine(
      (value) => value === "" || /^\d{4}$/.test(value),
      "Enter the last four digits only.",
    )
    .optional(),
  cardBrand: z.string().trim().max(40).optional(),
  failureReason: z.string().trim().max(500).optional(),
  /** Supplied by the form so a double-submit cannot create two payments. */
  idempotencyKey: z.string().trim().min(1).max(100),
});

export async function recordPaymentAction(
  _previous: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  const user = await requirePermission(PERMISSIONS.PAYMENT_RECORD);

  const parsed = recordPaymentSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const booking = await prisma.booking.findUnique({
    where: { id: parsed.data.bookingId },
    select: { currency: true },
  });

  if (!booking) return { error: "That booking no longer exists." };

  // Parsed against the booking's currency, so the minor-unit precision is right.
  const amountMinor = parseAmountToMinor(parsed.data.amount, booking.currency);

  if (amountMinor === null || amountMinor <= 0) {
    return { fieldErrors: { amount: `Enter a valid amount in ${booking.currency}.` } };
  }

  try {
    const result = await recordPayment(
      {
        bookingId: parsed.data.bookingId,
        amountMinor,
        currency: booking.currency,
        method: parsed.data.method,
        status: parsed.data.status,
        provider: parsed.data.provider || undefined,
        providerTransactionId: parsed.data.providerTransactionId || undefined,
        paymentUrl: parsed.data.paymentUrl || undefined,
        cardLast4: parsed.data.cardLast4 || undefined,
        cardBrand: parsed.data.cardBrand || undefined,
        failureReason: parsed.data.failureReason || undefined,
        idempotencyKey: parsed.data.idempotencyKey,
      },
      user.id,
    );

    revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
    revalidatePath("/admin/payments");

    return {
      success: result.alreadyExisted
        ? "That payment was already recorded."
        : "Payment recorded.",
    };
  } catch (error) {
    const message = operatorMessage(error);
    if (message) return { error: message };

    log.error({ err: error }, "Failed to record payment");
    return { error: "The payment could not be recorded. Try again." };
  }
}

const reconcileSchema = z.object({
  paymentId: z.string().trim().min(1),
  reconciliationStatus: z.enum(ReconciliationStatus),
});

export async function reconcilePaymentAction(
  _previous: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  const user = await requirePermission(PERMISSIONS.PAYMENT_RECONCILE);

  const parsed = reconcileSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await setReconciliationStatus(
      parsed.data.paymentId,
      parsed.data.reconciliationStatus,
      user.id,
    );
  } catch (error) {
    log.error({ err: error }, "Failed to set reconciliation status");
    return { error: "The payment could not be updated. Try again." };
  }

  revalidatePath("/admin/payments");
  return { success: "Reconciliation status updated." };
}

// --- Refunds ----------------------------------------------------------------

const requestRefundSchema = z.object({
  bookingId: z.string().trim().min(1),
  paymentId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  kind: z.enum(RefundKind),
  amount: z.string().trim().min(1, "Enter an amount."),
  reason: z.string().trim().min(1, "Enter a reason.").max(1_000),
  idempotencyKey: z.string().trim().min(1).max(100),
});

export async function requestRefundAction(
  _previous: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  const user = await requirePermission(PERMISSIONS.REFUND_REQUEST);

  const parsed = requestRefundSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const booking = await prisma.booking.findUnique({
    where: { id: parsed.data.bookingId },
    select: { currency: true },
  });

  if (!booking) return { error: "That booking no longer exists." };

  const amountMinor = parseAmountToMinor(parsed.data.amount, booking.currency);

  if (amountMinor === null || amountMinor <= 0) {
    return { fieldErrors: { amount: `Enter a valid amount in ${booking.currency}.` } };
  }

  try {
    const result = await requestRefund(
      {
        bookingId: parsed.data.bookingId,
        paymentId: parsed.data.paymentId,
        kind: parsed.data.kind,
        requestedAmountMinor: amountMinor,
        reason: parsed.data.reason,
        idempotencyKey: parsed.data.idempotencyKey,
      },
      user.id,
    );

    revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
    revalidatePath("/admin/refunds");

    return {
      success: result.alreadyExisted
        ? "That request was already submitted."
        : `${parsed.data.kind === RefundKind.VOID ? "Void" : "Refund"} requested — awaiting approval.`,
    };
  } catch (error) {
    const message = operatorMessage(error);
    if (message) return { error: message };

    log.error({ err: error }, "Failed to request refund");
    return { error: "The request could not be submitted. Try again." };
  }
}

const decisionSchema = z.object({
  refundId: z.string().trim().min(1),
  decision: z.enum(["approve", "reject"]),
  amount: z.string().trim().optional(),
  note: z.string().trim().max(2_000).optional(),
});

export async function decideRefundAction(
  _previous: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  const user = await requirePermission(PERMISSIONS.REFUND_APPROVE);

  const parsed = decisionSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid request." };

  const refund = await prisma.refund.findUnique({
    where: { id: parsed.data.refundId },
    select: { currency: true, requestedAmountMinor: true, bookingId: true },
  });

  if (!refund) return { error: "That refund no longer exists." };

  try {
    if (parsed.data.decision === "reject") {
      if (!parsed.data.note) {
        return { fieldErrors: { note: "Enter a reason for rejecting." } };
      }

      await rejectRefund(parsed.data.refundId, parsed.data.note, user.id);
      revalidatePath("/admin/refunds");
      return { success: "Refund rejected." };
    }

    // Approving without an explicit amount approves what was requested.
    const amountMinor = parsed.data.amount
      ? parseAmountToMinor(parsed.data.amount, refund.currency)
      : refund.requestedAmountMinor;

    if (amountMinor === null || amountMinor <= 0) {
      return { fieldErrors: { amount: `Enter a valid amount in ${refund.currency}.` } };
    }

    await approveRefund(
      {
        refundId: parsed.data.refundId,
        approvedAmountMinor: amountMinor,
        decisionNote: parsed.data.note,
      },
      user.id,
      user.role,
    );

    revalidatePath("/admin/refunds");
    revalidatePath(`/admin/bookings/${refund.bookingId}`);
    return { success: "Refund approved." };
  } catch (error) {
    const message = operatorMessage(error);
    if (message) return { error: message };

    log.error({ err: error }, "Failed to decide refund");
    return { error: "The decision could not be saved. Try again." };
  }
}

const executeSchema = z.object({
  refundId: z.string().trim().min(1),
  note: z.string().trim().min(1, "Describe how the refund was executed.").max(2_000),
});

export async function executeRefundAction(
  _previous: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  const user = await requirePermission(PERMISSIONS.REFUND_PROCESS);

  const parsed = executeSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { fieldErrors: { note: parsed.error.issues[0]?.message ?? "Invalid." } };
  }

  try {
    await completeRefundManually(parsed.data.refundId, parsed.data.note, user.id);
  } catch (error) {
    const message = operatorMessage(error);
    if (message) return { error: message };

    log.error({ err: error }, "Failed to execute refund");
    return { error: "The refund could not be recorded as executed. Try again." };
  }

  revalidatePath("/admin/refunds");
  return {
    // Worded carefully: the CRM recorded an operator action, it did not execute
    // anything through a provider.
    success: "Recorded as manually executed. No provider processed this refund.",
  };
}

/** Fresh idempotency key for a form render, so each submission is distinct. */
export async function newIdempotencyKey(): Promise<string> {
  return randomUUID();
}
