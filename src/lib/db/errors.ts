import "server-only";

/**
 * Database failure classification.
 *
 * An outage is not a user error. When Postgres is unreachable the caller should
 * show "temporarily unavailable" rather than letting a Prisma stack trace reach
 * the browser — the trace names internal paths and query shapes, and tells the
 * operator nothing they can act on.
 */

/** Prisma error codes that mean the database could not be reached or answered. */
const INFRASTRUCTURE_CODES = new Set([
  "P1000", // authentication failed
  "P1001", // can't reach database server
  "P1002", // connection timed out
  "P1008", // operation timed out
  "P1017", // server closed the connection
  "P2024", // connection pool timeout
  "P2028", // transaction API error
]);

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** True when the failure is the database being unavailable, not bad input. */
export function isDatabaseUnavailable(error: unknown): boolean {
  const code = codeOf(error);
  if (code !== undefined && INFRASTRUCTURE_CODES.has(code)) return true;

  // The pg driver surfaces connection refusal before Prisma assigns a code.
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND") {
    return true;
  }

  if (error instanceof Error) {
    const message = error.message;
    if (
      message.includes("Can't reach database server") ||
      message.includes("DatabaseNotReachable") ||
      message.includes("Connection terminated")
    ) {
      return true;
    }
  }

  return false;
}

/** Message shown to an operator when the database is unreachable. */
export const DATABASE_UNAVAILABLE_MESSAGE =
  "The service is temporarily unavailable. The database could not be reached — try again shortly, or contact your administrator if this persists.";
