import "server-only";

import {
  contentTypeForKey,
  isInlineImageSrc,
  storageKeyFromPath,
} from "@/lib/html/inline-image";
import { loggerFor } from "@/lib/logging/logger";
import { ObjectNotFoundError, getStorage } from "@/lib/storage";

/**
 * Carries the itinerary into a customer-facing email.
 *
 * The itinerary is the one field in this application composed as markup rather
 * than escaped at render — see `src/lib/html/sanitise.ts`, which is what makes
 * embedding it here safe. It can hold text, tables and images, and the images
 * are not decoration: an itinerary is sometimes nothing but a screenshot of the
 * carrier's own ticket, so a copy of the email without them is not a copy of
 * the itinerary.
 *
 * Those images cannot simply travel as the `src` they are stored under.
 * `/api/admin/bookings/images/...` is a relative path behind an administrator's
 * session: a mail client has no base URL to resolve it against, and would be
 * refused if it did. That route is deliberate — it documents itself as the only
 * way these bytes leave the server, with no public URL and no pre-signed link —
 * so the fix is to carry the bytes rather than to open the route.
 *
 * Hence two renderings of the same markup, both produced here so they cannot
 * disagree:
 *
 *   * `forEmail` attaches each image to the message and points its `src` at
 *     the attachment's `cid:`. The bytes travel inside the email, which is what
 *     makes it survive forwarding, offline reading and a mailbox that never had
 *     a session on this origin.
 *   * `forPreview` inlines each image as a `data:` URI. The preview renders in
 *     a `sandbox=""` iframe, an opaque origin that sends no cookies and cannot
 *     resolve a relative path either, so the stored `src` fails there for its
 *     own reasons.
 */

const log = loggerFor("mail-itinerary");

/** An image carried inside the message body. */
export interface InlineAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Referenced by the body as `src="cid:<cid>"`. */
  cid: string;
}

export interface PreparedItinerary {
  /** Sanitised markup with every image `src` rewritten, or null if there is none. */
  html: string | null;
  attachments: InlineAttachment[];
}

const EMPTY: PreparedItinerary = { html: null, attachments: [] };

/**
 * Total attached image bytes allowed in one message.
 *
 * Each upload is capped at 5 MB and an itinerary may hold several. Providers
 * reject an oversized message outright, which would lose the whole email — the
 * booking detail included — over an image. Past this point images are dropped
 * and the itinerary is sent without them, which is the lesser failure, and the
 * drop is logged rather than being silent.
 */
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;

/** A whole `<img>` tag, and its `src` within it; the sanitiser emits double quotes. */
const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTRIBUTE = /\bsrc="([^"]*)"/i;

/**
 * A stable content id for a storage key.
 *
 * Derived from the key rather than randomised, so the same image referenced
 * twice in one itinerary is attached once and both references resolve to it.
 * The key is opaque by construction and carries no traveller detail, which is
 * what makes it safe to put in a header a recipient can read.
 */
function contentIdFor(key: string): string {
  const basename = key.split("/").pop() ?? key;
  return `itinerary-${basename.replace(/[^0-9a-z.]/gi, "")}@booking`;
}

async function loadImages(
  html: string,
): Promise<Map<string, { buffer: Buffer; contentType: string; key: string }>> {
  const sources = new Set<string>();

  for (const tag of html.match(IMG_TAG) ?? []) {
    const src = tag.match(SRC_ATTRIBUTE)?.[1];
    // Anything the sanitiser would not have stored is left exactly as found:
    // this function's job is to relocate the application's own images, not to
    // re-litigate what is allowed in the markup.
    if (src && isInlineImageSrc(src)) sources.add(src);
  }

  const loaded = new Map<
    string,
    { buffer: Buffer; contentType: string; key: string }
  >();

  if (sources.size === 0) return loaded;

  const storage = getStorage();
  let totalBytes = 0;

  for (const src of sources) {
    const key = storageKeyFromPath(src);
    const contentType = key ? contentTypeForKey(key) : null;

    if (!key || !contentType) continue;

    try {
      const buffer = await storage.get(key);

      if (totalBytes + buffer.byteLength > MAX_TOTAL_IMAGE_BYTES) {
        log.warn(
          { key, totalBytes, imageBytes: buffer.byteLength },
          "Itinerary image dropped from email: attachment budget exhausted",
        );
        continue;
      }

      totalBytes += buffer.byteLength;
      loaded.set(src, { buffer, contentType, key });
    } catch (error: unknown) {
      // A referenced image that is no longer in storage must not cost the
      // customer their email. The reference is dropped below and the rest of
      // the itinerary is sent.
      if (error instanceof ObjectNotFoundError) {
        log.warn({ key }, "Itinerary image missing from storage; dropped");
        continue;
      }

      throw error;
    }
  }

  return loaded;
}

/**
 * Rewrites every resolved `src`, and removes the images that did not resolve.
 *
 * A dropped image leaves no `<img>` behind rather than a broken-image icon:
 * the customer cannot act on a placeholder, and on an itinerary that is only a
 * screenshot the absence is the honest signal that something is wrong.
 */
function rewrite(html: string, replacement: (src: string) => string | null): string {
  return html.replace(IMG_TAG, (tag) => {
    const src = tag.match(SRC_ATTRIBUTE)?.[1];

    // Not one of ours. The sanitiser already refused every other form of
    // `src`, so this is markup stored before that rule or none at all —
    // either way, untouched.
    if (!src || !isInlineImageSrc(src)) return tag;

    const next = replacement(src);
    if (next === null) return "";

    // Function form, so a `$` sequence in a base64 payload cannot be read as
    // a replacement pattern.
    const relocated = tag.replace(SRC_ATTRIBUTE, () => `src="${next}"`);

    // A screenshot of a carrier's ticket is routinely wider than the 640px the
    // message is laid out at, and an email client will not shrink it on its
    // own — it widens the whole table instead and the text beside it goes off
    // screen. The sanitiser does not allow `style` on an image, so this is the
    // first point at which one can be set, and it is set on output only.
    return relocated.includes("style=")
      ? relocated
      : relocated.replace(
          /<img\b/i,
          '<img style="max-width:100%;height:auto;"',
        );
  });
}

/**
 * The itinerary as it should appear in a sent email, with its images attached.
 *
 * `html` is already sanitised — it is read back from the column the sanitiser
 * wrote — so it is embedded as markup rather than escaped. Returns nulls for a
 * booking with no itinerary, which callers render as no section at all.
 */
export async function prepareItineraryForEmail(
  html: string | null | undefined,
): Promise<PreparedItinerary> {
  if (!html?.trim()) return EMPTY;

  const images = await loadImages(html);

  const attachments: InlineAttachment[] = [];

  const body = rewrite(html, (src) => {
    const image = images.get(src);
    if (!image) return null;

    const cid = contentIdFor(image.key);

    if (!attachments.some((attachment) => attachment.cid === cid)) {
      attachments.push({
        filename: image.key.split("/").pop() ?? "itinerary",
        content: image.buffer,
        contentType: image.contentType,
        cid,
      });
    }

    return `cid:${cid}`;
  });

  return { html: body, attachments };
}

/**
 * The same itinerary for the admin preview, with its images inlined.
 *
 * No attachments: there is no message to attach to. A `data:` URI renders in
 * the sandboxed preview frame, where the stored path would not.
 */
export async function prepareItineraryForPreview(
  html: string | null | undefined,
): Promise<string | null> {
  if (!html?.trim()) return null;

  const images = await loadImages(html);

  return rewrite(html, (src) => {
    const image = images.get(src);
    if (!image) return null;

    return `data:${image.contentType};base64,${image.buffer.toString("base64")}`;
  });
}
