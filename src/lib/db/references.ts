import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Human-facing reference numbers.
 *
 * Each kind draws from its own row in `ReferenceSequence`. MySQL has no
 * `CREATE SEQUENCE`, so the counter is advanced with the connector's own
 * idiom:
 *
 *     UPDATE ReferenceSequence SET value = LAST_INSERT_ID(value + 1) WHERE ...
 *
 * `LAST_INSERT_ID(expr)` stores `expr` against the session *and* returns it, so
 * the increment and the read are one statement against one row. Two agents
 * creating a booking at the same instant therefore receive different numbers —
 * unlike `max(...) + 1`, which races and collides on the unique constraint.
 *
 * Two differences from the Postgres sequences this replaces, neither of which
 * threatens that guarantee:
 *
 *   * The update rolls back with its transaction, where `nextval` did not. A
 *     rolled-back booking returns its number to the pool instead of burning it,
 *     which is harmless — the column is unique either way.
 *   * The row stays write-locked until the transaction commits, so concurrent
 *     allocations of the *same* kind serialise. Callers allocate a reference as
 *     late as they can and do no slow work afterwards, which keeps that window
 *     to a single statement.
 *
 * Gaps remain fine; duplicates remain not.
 */

const SEQUENCES = {
  booking: "booking_number",
  customer: "customer_reference",
  payment: "payment_reference",
  refund: "refund_reference",
  chargeback: "chargeback_reference",
  serviceCase: "service_case",
} as const;

type SequenceKind = keyof typeof SEQUENCES;

/**
 * Advances one counter and returns its new value.
 *
 * `client` must be connection-pinned — an interactive transaction, not the
 * pool. The two statements below communicate through `LAST_INSERT_ID`, which is
 * per-connection session state: issued against a bare pool they may be handed
 * different connections, and the SELECT would then read whatever that second
 * connection last inserted, or zero. `nextVal` below is what guarantees the
 * pinning; nothing else may call this.
 */
async function allocate(
  client: Prisma.TransactionClient,
  sequence: string,
): Promise<number> {
  const updated = await client.$executeRaw`
    UPDATE \`ReferenceSequence\`
    SET \`value\` = LAST_INSERT_ID(\`value\` + 1), \`updatedAt\` = NOW(3)
    WHERE \`kind\` = ${sequence}
  `;

  // The migration seeds one row per kind. A missing row means the schema and
  // this map have diverged, which must not be papered over by inventing a
  // starting point — the numbers already issued are unknown from here.
  if (updated === 0) {
    throw new Error(
      `Reference sequence "${sequence}" has no row in ReferenceSequence.`,
    );
  }

  // Reads back what the UPDATE just stored on this same connection.
  const rows = await client.$queryRaw<{ value: bigint }[]>`
    SELECT LAST_INSERT_ID() AS \`value\`
  `;

  const value = rows[0]?.value;
  if (value === undefined) {
    throw new Error(`Sequence ${sequence} returned no value.`);
  }

  return Number(value);
}

/**
 * Allocates the next value for a kind, joining the caller's transaction when
 * there is one and opening a short transaction of its own when there is not.
 *
 * The transaction is not about atomicity across several writes — it is how a
 * single connection is held for both statements in `allocate`.
 */
async function nextVal(
  kind: SequenceKind,
  tx?: Prisma.TransactionClient,
): Promise<number> {
  const sequence = SEQUENCES[kind];

  if (tx) return allocate(tx, sequence);

  return prisma.$transaction((pinned) => allocate(pinned, sequence));
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
