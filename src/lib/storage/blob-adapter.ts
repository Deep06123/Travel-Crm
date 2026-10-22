import "server-only";

import { createHash } from "node:crypto";

import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";

import {
  ObjectNotFoundError,
  type PutObjectInput,
  type StorageAdapter,
  type StoredObject,
} from "./types";

/**
 * Vercel Blob storage.
 *
 * For serverless deployments, where the local-disk adapter cannot work: the
 * filesystem is read-only apart from `/tmp`, and `/tmp` is not shared between
 * invocations, so a document written during an upload would be gone before the
 * request that reads it back.
 *
 * Every object is stored with `access: "private"`. That is not a detail — the
 * documents module is built on the guarantee that bytes leave the server only
 * through `/api/admin/documents/[id]/view`, which re-checks `document.view` on
 * every fetch. A public blob would hand out an unauthenticated URL and quietly
 * void that guarantee, so `access` is hard-coded here rather than configured.
 *
 * `addRandomSuffix` is off because keys are already generated from 24 random
 * bytes by `generateStorageKey`, and the stored key must round-trip exactly:
 * the database records it, and a suffix appended by the SDK would make the row
 * point at a pathname that does not exist.
 */
export class BlobStorageAdapter implements StorageAdapter {
  readonly name = "vercel-blob";

  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async put({ key, body, contentType }: PutObjectInput): Promise<StoredObject> {
    const result = await put(key, body, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      token: this.token,
    });

    // The store does not return a digest, so it is computed from the bytes we
    // sent. The document service compares this against the checksum recorded
    // at upload to detect a corrupted or substituted object.
    return {
      key: result.pathname,
      sizeBytes: body.byteLength,
      checksum: createHash("sha256").update(body).digest("hex"),
    };
  }

  async get(key: string): Promise<Buffer> {
    let result;

    try {
      // `useCache: false` reads from origin rather than the CDN. A document can
      // be replaced by a new version under the same key, and serving a cached
      // copy of the previous one would show the wrong passport scan.
      result = await get(key, {
        access: "private",
        useCache: false,
        token: this.token,
      });
    } catch (error) {
      if (error instanceof BlobNotFoundError) throw new ObjectNotFoundError(key);
      throw error;
    }

    // `get` resolves to null for a missing object rather than throwing.
    if (!result) throw new ObjectNotFoundError(key);

    const chunks: Uint8Array[] = [];
    // @ts-expect-error — the SDK types the stream as a web ReadableStream, which
    // is async-iterable at runtime on Node 18+ but not yet in the lib typings.
    for await (const chunk of result.stream) {
      chunks.push(chunk as Uint8Array);
    }

    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    try {
      await del(key, { token: this.token });
    } catch (error) {
      // Deleting something already gone is the desired end state, not a fault.
      if (error instanceof BlobNotFoundError) return;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await head(key, { token: this.token });
      return true;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return false;
      throw error;
    }
  }
}
