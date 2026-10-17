import "server-only";

import { randomBytes } from "node:crypto";

import { getEnv } from "@/lib/env";

import { LocalStorageAdapter } from "./local-adapter";
import type { StorageAdapter } from "./types";

export * from "./types";

/**
 * Storage selection.
 *
 * Only the local adapter exists today because no S3-compatible credentials are
 * configured. When they are, add the S3 adapter here and switch on
 * `STORAGE_DRIVER` — nothing above this module changes.
 */

let cached: StorageAdapter | undefined;

export function getStorage(): StorageAdapter {
  if (cached) return cached;

  const env = getEnv();

  switch (env.STORAGE_DRIVER) {
    case "local":
      cached = new LocalStorageAdapter(env.STORAGE_LOCAL_ROOT);
      return cached;

    default: {
      // Exhaustiveness guard: adding a driver to the enum without handling it
      // here becomes a compile error rather than a runtime surprise.
      const unreachable: never = env.STORAGE_DRIVER;
      throw new Error(`Unsupported storage driver: ${String(unreachable)}`);
    }
  }
}

/**
 * Generates an opaque storage key.
 *
 * Deliberately carries no customer name, passport number or original filename —
 * the plan requires that a key never leaks traveller detail, and keys end up in
 * logs, backups and object listings. The date prefix is for operational
 * housekeeping only.
 */
export function generateStorageKey(extension: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const random = randomBytes(24).toString("hex");

  const suffix = extension.replace(/[^a-z0-9]/gi, "").toLowerCase();

  return `documents/${year}/${month}/${random}${suffix ? `.${suffix}` : ""}`;
}
