import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Human-facing reference numbers.
 *
 * Each kind draws from its own Postgres sequence. `nextval` is atomic, so two
 * agents creating a booking at the same instant receive different numbers —
 * unlike `max(...) + 1`, which races and collides on the unique constraint.
 *
 * Sequences do not roll back, so an abandoned transaction leaves a gap. Gaps
 * are fine; duplicates are not.
 */

const SEQUENCES = {
  booking: "booking_number_seq",
  customer: "customer_reference_seq",
  payment: "payment_reference_seq",
  refund: "refund_reference_seq",
  chargeback: "chargeback_reference_seq",
  serviceCase: "service_case_seq",
} as const;

type SequenceKind = keyof typeof SEQUENCES;

async function nextVal(
  kind: SequenceKind,
  tx?: Prisma.TransactionClient,
): Promise<number> {
  const client = tx ?? prisma;
  const sequence = SEQUENCES[kind];

  // The sequence name comes from the constant map above, never from caller
  // input, so there is nothing injectable here.
  const rows = await client.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('${sequence}') AS nextval`,
  );

  const value = rows[0]?.nextval;
  if (value === undefined) {
    throw new Error(`Sequence ${sequence} returned no value.`);
  }

  return Number(value);
}

/** Booking number in the reference CRM's format, e.g. `MV70056`. */
export async function nextBookingNumber(
  tx?: Prisma.TransactionClient,
): Promise<string> {
  return `MV${await nextVal("booking", tx)}`;
}

/** Customer reference, e.g. `CUS-100042`. */
export async function nextCustomerReference(
  tx?: Prisma.TransactionClient,
): Promise<string> {
  return `CUS-${await nextVal("customer", tx)}`;
}

/** Payment reference, e.g. `PAY-000123`. */
export async function nextPaymentReference(
  tx?: Prisma.TransactionClient,
): Promise<string> {
  return `PAY-${String(await nextVal("payment", tx)).padStart(6, "0")}`;
}

/** Refund or void reference, e.g. `RFD-000123`. */
export async function nextRefundReference(
  tx?: Prisma.TransactionClient,
): Promise<string> {
  return `RFD-${String(await nextVal("refund", tx)).padStart(6, "0")}`;
}

/** Chargeback case reference, e.g. `CBK-000123`. */
export async function nextChargebackReference(
  tx?: Prisma.TransactionClient,
): Promise<string> {
  return `CBK-${String(await nextVal("chargeback", tx)).padStart(6, "0")}`;
}

/** Customer service case number, e.g. `CASE-000123`. */
export async function nextServiceCaseNumber(
  tx?: Prisma.TransactionClient,
): Promise<string> {
  return `CASE-${String(await nextVal("serviceCase", tx)).padStart(6, "0")}`;
}
