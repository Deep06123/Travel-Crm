import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";

const log = loggerFor("health");

/** Never cached: a readiness answer from thirty seconds ago is not an answer. */
export const dynamic = "force-dynamic";

/**
 * Readiness probe.
 *
 * Reports whether this instance can actually answer a query, which on a
 * serverless deployment is a per-instance question rather than a global one: an
 * instance that cannot reach MySQL, or that is waiting on a saturated
 * connection pool, is broken while its neighbours are fine. A plain uptime
 * check against the home page cannot distinguish "still starting" from
 * "broken", and that distinction is the whole reason this exists.
 *
 * Deliberately unauthenticated — a probe that needs a session cannot run before
 * sign-in works — and deliberately uninformative. It exposes no counts, no
 * identifiers and no configuration: only whether the database answered, and how
 * long the round trip took.
 */
export async function GET(): Promise<Response> {
  const started = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return Response.json(
      { status: "ok", databaseMs: Date.now() - started },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    // The detail goes to the server log, not the response: a probe is readable
    // by anyone who can reach it, and a driver error names internals.
    log.error({ err: error }, "Health check failed");

    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
