import "server-only";

import { loggerFor } from "@/lib/logging/logger";

const log = loggerFor("upsert-retry");

/**
 * Retry wrapper for `upsert` on MySQL.
 *
 * Prisma implements `upsert` as a SELECT followed by an INSERT or an UPDATE,
 * not as a single `INSERT … ON DUPLICATE KEY UPDATE`. Two transient failures
 * follow from that on MySQL, and both are retryable because the second attempt
 * reads the row the first one missed and takes the UPDATE branch instead:
 *
 *   * **MySQL 1020, `ER_CHECKREAD`** — "Record has changed since last read".
 *     Raised when the INSERT's foreign-key check finds the parent row altered
 *     by a transaction that was still open at the time of the SELECT. This is
 *     a real pattern here rather than a theoretical one: `transitionBooking`
 *     commits a booking change and then dispatches a lifecycle email in the
 *     background, so the next transition's transaction routinely overlaps the
 *     previous email's write to `Notification`. PostgreSQL took a key-share
 *     lock and waited; MySQL fails the statement instead.
 *
 *   * **Unique-constraint violation** — two callers whose SELECTs both missed
 *     the row and whose INSERTs then collided. Genuinely concurrent, and the
 *     loser should update rather than fail.
 *
 * Deliberately narrow. Only an `upsert` may be wrapped, because only an upsert
 * is idempotent by construction — re-running a plain INSERT on a unique
 * violation would be a way to write a second row, not a way to recover.
 */

/** MySQL error numbers worth a second attempt. */
const RETRYABLE_MYSQL_CODES = new Set([
  "1020", // ER_CHECKREAD   — record changed since last read
  "1213", // ER_LOCK_DEADLOCK
  "1205", // ER_LOCK_WAIT_TIMEOUT
]);

/** Prisma's own code for a unique-constraint violation. */
const UNIQUE_VIOLATION = "P2002";

function isRetryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const { code, meta } = error as { code?: unknown; meta?: unknown };

  if (code === UNIQUE_VIOLATION) return true;

  // Driver-level failures reach us wrapped: Prisma reports P2039 and hangs the
  // original MySQL error number off `meta`.
  const cause = (meta as { driverAdapterError?: { cause?: unknown } } | undefined)
    ?.driverAdapterError?.cause;

  if (typeof cause !== "object" || cause === null) return false;

  const original = (cause as { originalCode?: unknown }).originalCode;
  return typeof original === "string" && RETRYABLE_MYSQL_CODES.has(original);
}

/** Backoff between attempts. Short: the blocking transaction is a few ms long. */
const DELAYS_MS = [20, 60, 150];

/**
 * Runs an upsert, retrying the transient MySQL failures described above.
 *
 * `label` names the operation in the log, so a deployment that retries
 * constantly is visible rather than merely slow.
 */
export async function withUpsertRetry<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (attempt >= DELAYS_MS.length || !isRetryable(error)) throw error;

      const delay = DELAYS_MS[attempt] as number;

      log.warn(
        { label, attempt: attempt + 1, delay },
        "Upsert hit a transient conflict — retrying",
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
