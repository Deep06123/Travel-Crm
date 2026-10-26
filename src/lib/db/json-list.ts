import "server-only";

/**
 * Decoding for the columns that used to be PostgreSQL arrays.
 *
 * MySQL has no array type, so `Agent.allowedIpRanges`, `Supplier.supportedProducts`
 * and `MessageGroup.memberIds` are JSON documents. A JSON column enforces that
 * the value is well-formed JSON and nothing further: the database will accept
 * `{}`, `[1, null]` or a bare string in a column the application believes holds
 * a list of strings, and Prisma types it as `JsonValue` for exactly that reason.
 *
 * So every read goes through here instead of casting. The functions below never
 * throw and never propagate a malformed element — a row edited by hand, written
 * by an older build or restored from a dump of a different shape degrades to the
 * entries that are usable, rather than taking down the page that renders it.
 * Dropping a bad entry is the right failure for all three: a corrupt CIDR string
 * should not widen access, and a member id that is not a string cannot name an
 * administrator.
 */

/** Strings from a JSON array column; anything else yields an empty list. */
export function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Members of `allowed` from a JSON array column.
 *
 * Used for enum-valued lists such as `Supplier.supportedProducts`, where a
 * stored value outside the enum would otherwise flow into UI and query code
 * typed as if it could not happen.
 */
export function toEnumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] {
  const permitted = new Set<string>(allowed);
  return toStringList(value).filter((entry): entry is T => permitted.has(entry));
}
