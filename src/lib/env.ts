// Build-time guard. `assertServerOnly()` below still catches a runtime slip,
// but importing this from a Client Component should fail the build rather than
// wait until someone loads the page.
import "server-only";

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

  /**
   * Database connections held per application instance.
   *
   * Unset is correct almost always: 10 on a single host, 3 on Vercel, where the
   * real ceiling is this number multiplied by every live instance. Raise it
   * only against a database whose connection limit you have actually checked.
   */
  DB_POOL_MAX: z.coerce.number().int().positive().max(100).optional(),

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
  /**
   * Where uploaded documents are stored.
   *
   * `local` writes to disk and suits a single host. `blob` stores objects in
   * Vercel Blob with private access, and is the only workable choice on a
   * serverless platform: there the filesystem is read-only apart from `/tmp`,
   * and `/tmp` is not shared between invocations, so a document written during
   * an upload is gone before the request that reads it back.
   */
  STORAGE_DRIVER: z.enum(["local", "blob"]).default("local"),

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

  /**
   * Read-write token for the Vercel Blob store. Injected automatically by
   * Vercel once a Blob store is linked to the project.
   */
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  /**
   * Outbound email transport.
   *
   * `none` is the default on purpose. Without it, an unconfigured deployment
   * would have to choose between crashing on the first confirmation and
   * silently pretending to have emailed the customer. Under `none` the
   * notification is still recorded, as SUPPRESSED with the reason — the
   * operator can see that an email was owed and was not sent.
   *
   * `smtp` covers every mainstream provider (SES, SendGrid, Postmark, Mailgun,
   * Gmail) plus a local catcher such as Mailpit for development.
   */
  MAIL_DRIVER: z.enum(["none", "smtp"]).default("none"),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65_535).default(587),
  /**
   * True for implicit TLS (port 465). Leave false for 587, where nodemailer
   * upgrades the connection with STARTTLS.
   */
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  /** Envelope sender, e.g. `Travel CRM <bookings@example.com>`. */
  MAIL_FROM: z.string().optional(),
  /** Where customer replies should land, if different from MAIL_FROM. */
  MAIL_REPLY_TO: z.email().optional(),
})
  // Checked here rather than at send time: a misconfigured mail setup should
  // fail at startup with a readable message, not hours later when a customer
  // was supposed to receive a confirmation.
  .superRefine((env, ctx) => {
    // Caught at startup rather than at the first upload. A deployment missing
    // this token would otherwise accept a document, fail to store the bytes,
    // and leave a database row pointing at nothing.
    if (env.STORAGE_DRIVER === "blob" && !env.BLOB_READ_WRITE_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["BLOB_READ_WRITE_TOKEN"],
        message:
          'BLOB_READ_WRITE_TOKEN is required when STORAGE_DRIVER is "blob". Link a Blob store to the project in the Vercel dashboard and it is injected automatically.',
      });
    }

    if (env.MAIL_DRIVER !== "smtp") return;

    if (!env.SMTP_HOST) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_HOST"],
        message: "SMTP_HOST is required when MAIL_DRIVER is \"smtp\".",
      });
    }

    if (!env.MAIL_FROM) {
      ctx.addIssue({
        code: "custom",
        path: ["MAIL_FROM"],
        message: "MAIL_FROM is required when MAIL_DRIVER is \"smtp\".",
      });
    }

    // A username without a password is almost always a half-finished config,
    // and it fails at the provider as an authentication error that reads like
    // a credential problem rather than a missing variable.
    if (env.SMTP_USER && !env.SMTP_PASSWORD) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_PASSWORD"],
        message: "SMTP_PASSWORD is required when SMTP_USER is set.",
      });
    }
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

/**
 * Test seam. Configuration is parsed once and cached for the process, which is
 * correct in the application but leaves a test unable to exercise a different
 * configuration — the mail transport in particular.
 */
export function resetEnvCache(): void {
  cached = undefined;
}

/** True when running a production build. */
export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}
