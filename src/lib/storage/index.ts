import "server-only";

import { randomBytes } from "node:crypto";

import { getEnv } from "@/lib/env";

import { BlobStorageAdapter } from "./blob-adapter";
import { LocalStorageAdapter } from "./local-adapter";
import type { StorageAdapter } from "./types";

export * from "./types";

/**
 * Storage selection.
 *
 * `local` writes to disk, for a single host. `blob` stores objects privately in
 * Vercel Blob, for serverless deployments where the filesystem is read-only.
 * Both satisfy the same interface, so nothing above this module changes.
 */

let cached: StorageAdapter | undefined;

export function getStorage(): StorageAdapter {
  if (cached) return cached;

  const env = getEnv();

  switch (env.STORAGE_DRIVER) {
    case "local":
      cached = new LocalStorageAdapter(env.STORAGE_LOCAL_ROOT);
      return cached;

    case "blob": {
      // Non-null is safe: the env schema refuses to parse a `blob` driver
      // without this token, so configuration has already failed by here.
      cached = new BlobStorageAdapter(env.BLOB_READ_WRITE_TOKEN!);
      return cached;
    }

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
