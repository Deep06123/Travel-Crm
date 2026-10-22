import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logging/logger";

/**
 * Shared Prisma client.
 *
 * Cached on `globalThis` in every environment, for two different reasons.
 *
 * In development, Next.js re-evaluates modules on each edit, which would
 * otherwise open a fresh pool per reload until Postgres refuses connections.
 *
 * In production the same cache matters more, not less. A serverless deployment
 * loads this module once per instance, and Next.js bundles server components
 * and route handlers separately — without the global, a single instance can end
 * up holding several independent pools. Multiplied across concurrent instances
 * that is how a managed Postgres runs out of connections.
 */

type Client = PrismaClient<"warn" | "error">;

declare global {
  var __crmPrisma: Client | undefined;
}

/**
 * Connections held per instance.
 *
 * node-postgres defaults to 10, which is wrong on a serverless platform: the
 * ceiling is 10 × (number of live instances), and a free-tier Postgres allows
 * far fewer in total. A small per-instance pool, in front of the provider's own
 * pooler, is the arrangement that actually holds up.
 */
function poolSize(explicit: number | undefined): number {
  if (explicit !== undefined) return explicit;
  return process.env["VERCEL"] ? 3 : 10;
}

function createPrismaClient(): Client {
  const env = getEnv();

  // Prisma 7 requires an explicit driver adapter for SQL providers.
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: poolSize(env.DB_POOL_MAX),
    // Without this, a request that finds the pool saturated waits forever and
    // the platform kills the function with no explanation. Ten seconds turns
    // that into a logged error naming the real cause.
    connectionTimeoutMillis: 10_000,
  });

  const client = new PrismaClient({
    adapter,
    log: [
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ],
  });

  // Route driver diagnostics through the structured logger rather than stdout.
  client.$on("warn", (event) => logger.warn({ prisma: event }, "Prisma warning"));
  client.$on("error", (event) => logger.error({ prisma: event }, "Prisma error"));

  return client;
}

export const prisma: Client = globalThis.__crmPrisma ?? createPrismaClient();

globalThis.__crmPrisma = prisma;
