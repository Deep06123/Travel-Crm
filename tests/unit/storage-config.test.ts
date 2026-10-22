import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getEnv, resetEnvCache } from "@/lib/env";

/**
 * Storage configuration guards.
 *
 * The documents module trades on one promise: bytes leave the server only
 * through `/api/admin/documents/[id]/view`, which re-checks `document.view` on
 * every fetch. Two configuration mistakes would quietly void that promise, and
 * both fail here instead.
 *
 * The first is a serverless deployment left on the `local` driver, which writes
 * to a read-only filesystem. The second is the `blob` driver without a token,
 * which would accept an upload, fail to store the bytes, and leave a database
 * row pointing at nothing. Neither surfaces until someone uploads a passport
 * scan, so both are caught at startup.
 */

const REQUIRED = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  AUTH_SECRET: "x".repeat(32),
};

let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = { ...process.env };
  resetEnvCache();

  // Start from a clean slate so a value inherited from the developer's own
  // .env cannot mask a missing one.
  for (const key of [
    "STORAGE_DRIVER",
    "STORAGE_LOCAL_ROOT",
    "BLOB_READ_WRITE_TOKEN",
    "MAIL_DRIVER",
  ]) {
    delete process.env[key];
  }

  Object.assign(process.env, REQUIRED);
});

afterEach(() => {
  process.env = saved;
  resetEnvCache();
});

describe("storage configuration", () => {
  it("defaults to the local driver", () => {
    expect(getEnv().STORAGE_DRIVER).toBe("local");
  });

  it("accepts the blob driver when a token is present", () => {
    process.env["STORAGE_DRIVER"] = "blob";
    process.env["BLOB_READ_WRITE_TOKEN"] = "vercel_blob_rw_TEST_token";

    const env = getEnv();
    expect(env.STORAGE_DRIVER).toBe("blob");
    expect(env.BLOB_READ_WRITE_TOKEN).toBe("vercel_blob_rw_TEST_token");
  });

  it("refuses the blob driver without a token", () => {
    process.env["STORAGE_DRIVER"] = "blob";

    expect(() => getEnv()).toThrowError(/BLOB_READ_WRITE_TOKEN is required/);
  });

  it("rejects an unknown driver rather than falling back to local", () => {
    process.env["STORAGE_DRIVER"] = "s3";

    expect(() => getEnv()).toThrowError(/STORAGE_DRIVER/);
  });

  it("refuses a local root under public/, where files would be world-readable", () => {
    process.env["STORAGE_DRIVER"] = "local";
    process.env["STORAGE_LOCAL_ROOT"] = "./public/uploads";

    expect(() => getEnv()).toThrowError(/must not live under public\//);
  });
});
