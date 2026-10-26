import { requireAuthOrThrow } from "@/lib/auth/dal";
import {
  INLINE_IMAGE_ROUTE,
  isInlineImageSrc,
  storageKeyFromPath,
} from "@/lib/html/inline-image";
import {
  ForbiddenError,
  PERMISSIONS,
  getPermissionsForRole,
} from "@/lib/permissions";
import { ObjectNotFoundError, getStorage } from "@/lib/storage";

/** Content type per extension, from the allow-list the upload enforced. */
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Serves an image embedded in an itinerary.
 *
 * The only way these bytes leave the server. There is no public URL and no
 * pre-signed link: an itinerary can describe a customer's movements, and the
 * images in it are no less identifying than the text around them.
 *
 * The type sent back is derived from the key's own extension rather than from
 * anything stored with the object, and the key's extension could only have
 * been set by the upload route from its allow-list. A file that lied about its
 * type on the way in therefore still cannot be served as HTML on the way out.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  try {
    const user = await requireAuthOrThrow();

    const granted = await getPermissionsForRole(user.role);
    if (!granted.has(PERMISSIONS.BOOKING_VIEW)) {
      throw new ForbiddenError(PERMISSIONS.BOOKING_VIEW);
    }
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  const { key: segments } = await context.params;
  const pathname = `${INLINE_IMAGE_ROUTE}/${segments.join("/")}`;

  // Validated against the same pattern the sanitiser uses, so a traversal or
  // a hand-written key cannot reach an object this route never issued.
  if (!isInlineImageSrc(pathname)) {
    return new Response("Not found", { status: 404 });
  }

  const key = storageKeyFromPath(pathname);
  if (!key) return new Response("Not found", { status: 404 });

  let bytes: Buffer;

  try {
    bytes = await getStorage().get(key);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }

  const extension = key.split(".").pop() ?? "";

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      // Belt and braces: even if the type above were ever wrong, the browser
      // must not sniff its way to treating the bytes as a document.
      "X-Content-Type-Options": "nosniff",
      // The key is content-addressed by random bytes and never reused, so the
      // object at a given key cannot change.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(bytes.byteLength),
    },
  });
}
