import "server-only";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logging/logger";

import { mysqlPoolConfig } from "./mysql-url";

/**
 * Shared Prisma client, backed by MySQL.
 *
 * Cached on `globalThis` in every environment, for two different reasons.
 *
 * In development, Next.js re-evaluates modules on each edit, which would
 * otherwise open a fresh pool per reload until MySQL refuses connections.
 *
 * In production the same cache matters more, not less. A serverless deployment
 * loads this module once per instance, and Next.js bundles server components
 * and route handlers separately — without the global, a single instance can end
 * up holding several independent pools. Multiplied across concurrent instances
 * that is how a managed MySQL runs out of connections.
 */

type Client = PrismaClient<"warn" | "error">;

declare global {
  var __crmPrisma: Client | undefined;
}

/**
 * Connections held per instance.
 *
 * The mariadb driver defaults to 10, which is wrong on a serverless platform:
 * the ceiling is 10 × (number of live instances), and a small managed MySQL
 * allows far fewer in total. A modest per-instance pool, in front of whatever
 * proxy the provider puts in the way, is the arrangement that actually holds
 * up.
 */
function poolSize(explicit: number | undefined): number {
  if (explicit !== undefined) return explicit;
  return process.env["VERCEL"] ? 3 : 10;
}

function createPrismaClient(): Client {
  const env = getEnv();

  // Prisma 7 requires an explicit driver adapter for SQL providers. The URL is
  // decomposed because the driver accepts only `mariadb://` strings — see
  // `mysql-url.ts`.
  const adapter = new PrismaMariaDb(
    mysqlPoolConfig(env.DATABASE_URL, {
      connectionLimit: poolSize(env.DB_POOL_MAX),
    }),
  );

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
