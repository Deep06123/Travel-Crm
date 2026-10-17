import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * Every secret in this file stays on the server. Nothing here may be imported
 * from a Client Component — `assertServerOnly()` guards against that by
 * accident, and the absence of any `NEXT_PUBLIC_` key means nothing is inlined
 * into the browser bundle.
 */

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  /** PostgreSQL connection string used by Prisma. */
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (value) =>
        value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a PostgreSQL connection string",
    ),

  /**
   * Secret used to sign and encrypt session cookies. Must be at least 32
   * characters. Generate with `openssl rand -base64 32`.
   */
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters"),

  /** Canonical origin of the deployment, used for absolute callback URLs. */
  AUTH_URL: z.url().optional(),

  /** Session idle lifetime, in seconds. Defaults to 8 hours. */
  SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(28_800),

  /** Failed logins allowed per account before temporary lockout. */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  /** Lockout duration applied once LOGIN_MAX_ATTEMPTS is exceeded, in seconds. */
  LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(900),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  /** Default business timezone for date bucketing in reports. */
  BUSINESS_TIMEZONE: z.string().default("UTC"),

  /**
   * Where uploaded documents are stored. Only `local` is implemented; add `s3`
   * here and in `getStorage()` once S3-compatible credentials exist.
   */
  STORAGE_DRIVER: z.enum(["local"]).default("local"),

  /**
   * Root directory for the local driver.
   *
   * Must sit outside `public/` — anything under `public/` is served statically
   * by URL, which would make every uploaded document world-readable.
   */
  STORAGE_LOCAL_ROOT: z
    .string()
    .default("./storage")
    .refine(
      (value) => !/(^|[\\/])public([\\/]|$)/.test(value),
      "STORAGE_LOCAL_ROOT must not live under public/ — files there are served to anyone by URL.",
    ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "src/lib/env.ts was imported from client code. Server configuration must never reach the browser bundle.",
    );
  }
}

let cached: ServerEnv | undefined;

/**
 * Parses and caches server environment configuration.
 *
 * Throws with a readable summary of every missing or malformed variable rather
 * than failing later at the point of first use.
 */
export function getEnv(): ServerEnv {
  assertServerOnly();

  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  cached = parsed.data;
  return cached;
}

/** True when running a production build. */
export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}
