import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logging/logger";

/**
 * Shared Prisma client.
 *
 * Next.js reloads modules on every edit in development, which would otherwise
 * open a new connection pool per reload until Postgres refuses connections. The
 * instance is therefore cached on `globalThis` outside production.
 */

type Client = PrismaClient<"warn" | "error">;

declare global {
  var __crmPrisma: Client | undefined;
}

function createPrismaClient(): Client {
  const env = getEnv();

  // Prisma 7 requires an explicit driver adapter for SQL providers.
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

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

if (process.env.NODE_ENV !== "production") {
  globalThis.__crmPrisma = prisma;
}
