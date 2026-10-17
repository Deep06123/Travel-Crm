/**
 * Object storage contract.
 *
 * Document bytes never live in the database and never sit under the web root.
 * Everything goes through this interface, so swapping the local-disk adapter
 * for S3 is a one-line change in `getStorage()` — no call site moves.
 *
 * Keys are opaque. The plan is explicit that a filename must not leak traveller
 * detail, so the stored key is derived from random bytes rather than from the
 * uploaded filename, which is kept only as metadata for display.
 */

export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksum: string;
}

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StorageAdapter {
  /** Human-readable adapter name, surfaced in diagnostics. */
  readonly name: string;

  put(input: PutObjectInput): Promise<StoredObject>;

  get(key: string): Promise<Buffer>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    // The key is opaque and carries no personal data, so naming it is safe.
    super(`Stored object not found: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}
