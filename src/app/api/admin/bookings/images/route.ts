import { requireAuthOrThrow } from "@/lib/auth/dal";
import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_EXTENSIONS,
  INLINE_IMAGE_PREFIX,
  INLINE_IMAGE_ROUTE,
  MAX_IMAGE_BYTES,
} from "@/lib/html/inline-image";
import { loggerFor } from "@/lib/logging/logger";
import {
  ForbiddenError,
  PERMISSIONS,
  getPermissionsForRole,
} from "@/lib/permissions";
import { generateStorageKey, getStorage } from "@/lib/storage";

const log = loggerFor("itinerary-image-upload");

/**
 * Accepts an image for embedding in an itinerary.
 *
 * Stored through the same adapter as documents, so it works unchanged on local
 * disk or Vercel Blob, and served back only through the companion route — the
 * bytes never acquire a public URL.
 *
 * Uploading is governed by `booking.update`: an image inside the itinerary is
 * part of the booking's content, and anyone who may not edit the booking has
 * no business adding to it.
 */
export async function POST(request: Request): Promise<Response> {
  let actorId: string;

  try {
    const user = await requireAuthOrThrow();
    actorId = user.id;

    const granted = await getPermissionsForRole(user.role);
    if (!granted.has(PERMISSIONS.BOOKING_UPDATE)) {
      throw new ForbiddenError(PERMISSIONS.BOOKING_UPDATE);
    }
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "No image was supplied." }, { status: 400 });
  }

  // The browser's reported type, which is a hint rather than evidence — but
  // the stored object is only ever served back with a type from this same
  // allow-list, so a mislabelled file cannot be served as something else.
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return Response.json(
      { error: "Only PNG, JPEG, WebP and GIF images can be added." },
      { status: 415 },
    );
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json(
      {
        error: `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_IMAGE_BYTES / 1024 / 1024}MB.`,
      },
      { status: 413 },
    );
  }

  if (file.size === 0) {
    return Response.json({ error: "That image is empty." }, { status: 400 });
  }

  const key = generateStorageKey(
    IMAGE_EXTENSIONS[file.type] ?? "png",
    INLINE_IMAGE_PREFIX,
  );

  try {
    await getStorage().put({
      key,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
    });
  } catch (error) {
    log.error({ err: error, actorId }, "Itinerary image upload failed");
    return Response.json(
      { error: "The image could not be stored. Try again." },
      { status: 500 },
    );
  }

  log.info({ actorId, key, bytes: file.size }, "Itinerary image stored");

  // The editor puts this straight into the markup, and the sanitiser accepts
  // exactly this shape — see `isInlineImageSrc`.
  return Response.json({ url: `${INLINE_IMAGE_ROUTE}/${key}` });
}
