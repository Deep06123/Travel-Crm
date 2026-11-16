import { requireAuthOrThrow } from "@/lib/auth/dal";
import {
  IMAGE_EXTENSIONS,
  INLINE_IMAGE_PREFIX,
  INLINE_IMAGE_ROUTE,
  MAX_IMPORTED_IMAGES,
  MAX_IMPORT_TOTAL_BYTES,
} from "@/lib/html/inline-image";
import { RemoteImageError, fetchRemoteImage } from "@/lib/html/remote-image";
import { loggerFor } from "@/lib/logging/logger";
import {
  ForbiddenError,
  PERMISSIONS,
  getPermissionsForRole,
} from "@/lib/permissions";
import { generateStorageKey, getStorage } from "@/lib/storage";

const log = loggerFor("itinerary-image-import");

/**
 * Re-hosts images an operator pasted a reference to.
 *
 * The companion to the upload route beside it. That one takes bytes from the
 * operator's machine — a screenshot, a saved file. This one takes addresses,
 * because an itinerary is usually copied off the carrier's own booking page and
 * what the clipboard carries is markup pointing at the carrier's images, not
 * the images themselves.
 *
 * Without this the paste looked right and then lost its pictures on save: the
 * editor rendered the remote `src` straight from the carrier, and the sanitiser
 * dropped every one of them, because a stored remote image reports back to
 * whoever supplied it each time the booking is opened. Fetching the bytes once,
 * here, keeps that rule and still gives the operator what they pasted.
 *
 * Several addresses per request rather than one each: a pasted page routinely
 * carries a dozen, and a round trip apiece would make the paste feel broken.
 * Each is reported on independently — one carrier image behind a login must not
 * cost the operator the other eleven.
 *
 * Governed by `booking.update`, like the upload: an image inside the itinerary
 * is part of the booking's content.
 */

/** Imports run at once. Enough to be quick, few enough to stay a trickle. */
const CONCURRENCY = 4;

interface ImportResult {
  /** The address asked for, so the client can match this to its `<img>`. */
  source: string;
  /** The re-hosted path, or null when it could not be fetched. */
  url: string | null;
  error?: string;
}

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

  const body = (await request.json().catch(() => null)) as {
    urls?: unknown;
  } | null;

  const requested = Array.isArray(body?.urls)
    ? body.urls.filter((value): value is string => typeof value === "string")
    : null;

  if (!requested || requested.length === 0) {
    return Response.json(
      { error: "No image addresses were supplied." },
      { status: 400 },
    );
  }

  // Deduplicated before anything is fetched: the same logo appears three times
  // on a carrier's page, and downloading it three times would store it three
  // times as well.
  const sources = [...new Set(requested)].slice(0, MAX_IMPORTED_IMAGES);
  const storage = getStorage();

  let totalBytes = 0;
  const results: ImportResult[] = [];
  const startedAt = performance.now();

  /**
   * Walks the queue from a fixed number of workers.
   *
   * The byte budget is read and updated here rather than per worker, so what
   * survives an oversized paste does not depend on which download happened to
   * finish first.
   */
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= sources.length) return;

      const source = sources[index]!;

      if (totalBytes >= MAX_IMPORT_TOTAL_BYTES) {
        results[index] = {
          source,
          url: null,
          error: "Too many images in one paste; this one was left out.",
        };
        continue;
      }

      try {
        const image = await fetchRemoteImage(source);

        if (totalBytes + image.buffer.byteLength > MAX_IMPORT_TOTAL_BYTES) {
          results[index] = {
            source,
            url: null,
            error: "Too many images in one paste; this one was left out.",
          };
          continue;
        }

        totalBytes += image.buffer.byteLength;

        const key = generateStorageKey(
          IMAGE_EXTENSIONS[image.contentType] ?? "png",
          INLINE_IMAGE_PREFIX,
        );

        await storage.put({
          key,
          body: image.buffer,
          contentType: image.contentType,
        });

        results[index] = { source, url: `${INLINE_IMAGE_ROUTE}/${key}` };
      } catch (error) {
        // A message written for the operator, or a generic one — a storage
        // failure's detail belongs in the log, not in the browser.
        if (error instanceof RemoteImageError) {
          results[index] = { source, url: null, error: error.message };
          continue;
        }

        log.error({ err: error, actorId }, "Itinerary image import failed");
        results[index] = {
          source,
          url: null,
          error: "That image could not be stored. Try again.",
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, sources.length) }, worker),
  );

  const stored = results.filter((result) => result.url !== null).length;

  // The addresses themselves are not logged: an itinerary's images sit on a
  // URL that can name the carrier, the traveller or the booking reference.
  log.info(
    {
      actorId,
      requested: sources.length,
      stored,
      totalBytes,
      durationMs: Math.round(performance.now() - startedAt),
    },
    "Itinerary images imported",
  );

  return Response.json({ results });
}
