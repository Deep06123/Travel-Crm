import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { loggerFor } from "@/lib/logging/logger";

const log = loggerFor("health");

/** See the admin layout: a cold start must build the embedded database first. */
export const maxDuration = 60;

/** Never cached: a readiness answer from thirty seconds ago is not an answer. */
export const dynamic = "force-dynamic";

/**
 * Readiness probe.
 *
 * Reports whether this instance can actually answer a query, which on a
 * serverless deployment is a per-instance question rather than a global one:
 * without a hosted database each instance builds its own embedded PostgreSQL
 * and is unavailable for the several seconds that takes. A plain uptime check
 * against the home page cannot distinguish "still starting" from "broken", and
 * that distinction is the whole reason this exists.
 *
 * Deliberately unauthenticated — a probe that needs a session cannot run before
 * sign-in works — and deliberately uninformative. It exposes no counts, no
 * identifiers and no configuration: only whether the database answered, which
 * storage mode is in use, and how long the round trip took.
 */
export async function GET(): Promise<Response> {
  const env = getEnv();
  const storage = env.DATABASE_URL ? "hosted" : "embedded";
  const started = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return Response.json(
      { status: "ok", storage, databaseMs: Date.now() - started },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    // The detail goes to the server log, not the response: a probe is readable
    // by anyone who can reach it, and a driver error names internals.
    log.error({ err: error, storage }, "Health check failed");

    return Response.json(
      { status: "unavailable", storage },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
