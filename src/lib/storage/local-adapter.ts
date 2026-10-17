import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import {
  ObjectNotFoundError,
  type PutObjectInput,
  type StorageAdapter,
  type StoredObject,
} from "./types";

/**
 * Local filesystem storage.
 *
 * For development and single-host deployments. The root must sit OUTSIDE the
 * Next.js `public/` directory — anything under `public/` is served statically
 * by URL, which would make every uploaded passport scan world-readable.
 *
 * Swap for an S3 adapter in `getStorage()` when credentials exist; the document
 * service does not change.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly name = "local-disk";

  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * Maps a key to an absolute path, refusing anything that escapes the root.
   *
   * Keys are generated internally, but this is the last line of defence: a key
   * that ever reached here from user input must not be able to traverse out via
   * `../` and read or overwrite an arbitrary file.
   */
  private pathFor(key: string): string {
    const target = resolve(join(this.root, key));

    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error("Refusing to access a path outside the storage root.");
    }

    return target;
  }

  async put({ key, body }: PutObjectInput): Promise<StoredObject> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });

    // Written with no execute bit and owner-only permissions.
    await writeFile(target, body, { mode: 0o600 });

    return {
      key,
      sizeBytes: body.byteLength,
      checksum: createHash("sha256").update(body).digest("hex"),
    };
  }

  async get(key: string): Promise<Buffer> {
    const target = this.pathFor(key);

    try {
      return await readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}
