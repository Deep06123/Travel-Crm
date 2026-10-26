/**
 * Where an itinerary image lives, and what counts as one.
 *
 * Shared by the upload route, the serving route and the sanitiser, so the
 * three cannot drift. If they did, the sanitiser would either strip images the
 * application had just stored, or admit a `src` the serving route never
 * issued — and the second of those is the whole attack.
 *
 * Deliberately free of `server-only`: the editor needs the route path too.
 */

/** Route that serves a stored itinerary image. */
export const INLINE_IMAGE_ROUTE = "/api/admin/bookings/images";

/** Storage folder, kept away from `documents/`. */
export const INLINE_IMAGE_PREFIX = "itinerary-images";

/**
 * Formats accepted on upload.
 *
 * Raster only. SVG is an XML document that can carry script, and it would be
 * served from this origin with an administrator's session attached — an image
 * format that executes is not worth the convenience.
 */
export const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Largest upload accepted, in bytes.
 *
 * A screenshot is well under this. The cap exists because the editor's markup
 * is stored in a MySQL `TEXT` column, and because nothing else bounds how much
 * an operator can put into one booking.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * True for a `src` this application itself issued.
 *
 * The test is deliberately strict and positive: a same-origin path under the
 * serving route, with a storage key shaped exactly as `generateStorageKey`
 * produces. Anything else — a remote URL, a `data:` payload, a
 * protocol-relative `//host/x`, a `..` traversal — fails by not matching,
 * rather than by being guessed at and blocked.
 *
 * Remote images are the reason this is not simply "any https URL". One embedded
 * in a booking reports to whoever supplied it every time a member of staff
 * opens the record: who looked, when, and from which address.
 */
const SRC_PATTERN = new RegExp(
  `^${INLINE_IMAGE_ROUTE}/${INLINE_IMAGE_PREFIX}/\\d{4}/\\d{2}/[0-9a-f]{48}\\.(png|jpg|webp|gif)$`,
);

export function isInlineImageSrc(src: string): boolean {
  return SRC_PATTERN.test(src);
}

/** The storage key a serving-route path refers to. */
export function storageKeyFromPath(pathname: string): string | null {
  if (!isInlineImageSrc(pathname)) return null;
  return pathname.slice(INLINE_IMAGE_ROUTE.length + 1);
}
