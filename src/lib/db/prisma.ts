import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaPGlite } from "pglite-prisma-adapter";

import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logging/logger";

import { getEmbeddedDatabase } from "./embedded";

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

/**
 * Chooses where the data lives.
 *
 * With `DATABASE_URL` set, a hosted PostgreSQL — the arrangement for anything
 * holding real bookings. Without it, PostgreSQL compiled to WebAssembly and run
 * inside this process, so the application works with nothing to install or
 * provision. Both are genuinely Postgres, which is why no service, query or
 * transaction below this line is aware of the difference.
 */
function createAdapter(env: ReturnType<typeof getEnv>) {
  if (!env.DATABASE_URL) {
    return new PrismaPGlite(getEmbeddedDatabase());
  }

  // Prisma 7 requires an explicit driver adapter for SQL providers.
  return new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: poolSize(env.DB_POOL_MAX),
    // Without this, a request that finds the pool saturated waits forever and
    // the platform kills the function with no explanation. Ten seconds turns
    // that into a logged error naming the real cause.
    connectionTimeoutMillis: 10_000,
  });
}

function createPrismaClient(): Client {
  const env = getEnv();
  const adapter = createAdapter(env);

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
