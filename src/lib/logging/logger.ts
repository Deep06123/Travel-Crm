import "server-only";

import pino, { type Logger } from "pino";

import { getEnv } from "@/lib/env";

/**
 * Structured server-side logger.
 *
 * Field names listed in `redactPaths` are stripped before a record is written.
 * Traveller identifiers, payment references and credentials must never reach
 * the log stream, so new sensitive fields belong in this list as they are
 * introduced.
 */
const redactPaths = [
  "password",
  "passwordHash",
  "*.password",
  "*.passwordHash",
  "passportNumber",
  "*.passportNumber",
  "dateOfBirth",
  "*.dateOfBirth",
  "cardNumber",
  "*.cardNumber",
  "cvv",
  "*.cvv",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
];

declare global {
  var __crmLogger: Logger | undefined;
}

function createLogger(): Logger {
  const env = getEnv();

  return pino({
    level: env.LOG_LEVEL,
    redact: { paths: redactPaths, censor: "[redacted]" },
    base: { service: "travel-booking-crm", env: env.NODE_ENV },
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Human-readable output in development; newline-delimited JSON elsewhere so
    // a log collector can parse it.
    transport:
      env.NODE_ENV === "development"
        ? {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
          }
        : undefined,
  });
}

// Reused across hot reloads so development does not leak transport workers.
export const logger: Logger = globalThis.__crmLogger ?? createLogger();

if (process.env.NODE_ENV !== "production") {
  globalThis.__crmLogger = logger;
}

/** Returns a child logger tagged with a module name and optional context. */
export function loggerFor(
  module: string,
  context: Record<string, unknown> = {},
): Logger {
  return logger.child({ module, ...context });
}
