import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_EXTENSIONS,
  isInlineImageSrc,
} from "./inline-image";

/**
 * Reading the images out of HTML pasted into the itinerary editor.
 *
 * Deliberately free of `server-only` and of React: this runs in the browser,
 * against the clipboard's own `text/html`, and is kept apart from the editor
 * component so the rules about which images survive a paste can be tested
 * without mounting an editor.
 *
 * An operator pastes an itinerary by selecting it on the carrier's booking page
 * and copying. What arrives is markup whose images are somebody else's URLs.
 * Those cannot be stored — the sanitiser drops them, because an image left
 * pointing at a remote host tells that host every time the booking is opened —
 * so each one has to be fetched and re-hosted before the markup is inserted.
 *
 * Three kinds of `src` turn up in a real paste, and they are not handled alike:
 *
 *   * An absolute `http(s)` URL — the common case, sent to the import route.
 *   * A `data:` URI — what a spreadsheet, a document editor or a mail client
 *     puts on the clipboard. The bytes are already here, so they go to the
 *     ordinary upload route rather than being fetched.
 *   * Anything else — a relative path, `blob:`, `cid:`, a protocol-relative
 *     `//host/x`. None of these can be resolved from here, so the image is
 *     removed rather than left to be stripped silently on save.
 */

/** A `data:` image the browser can decode without a round trip. */
const DATA_URL = /^data:(image\/[a-z+]+);base64,([a-z0-9+/=\s]+)$/i;

/**
 * Below this, an image is a spacer or a tracking pixel rather than content.
 *
 * Importing one would be pointless work, and a 1×1 from an analytics host is
 * the one image on the page whose whole purpose is the callback this module
 * exists to prevent.
 */
const MIN_CONTENT_PIXELS = 3;

export interface CollectedImages {
  /** Absolute `http(s)` addresses to re-host through the import route. */
  remote: string[];
  /** `data:` URIs, already decodable here, to send through the upload route. */
  data: string[];
}

/** Parses clipboard HTML into a detached document. */
export function parsePastedHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/**
 * Lists the images worth fetching, removing the ones that are not.
 *
 * Mutates the document: an `<img>` that cannot be resolved is taken out here,
 * which is the same outcome the sanitiser would reach on save — reached early,
 * so what the operator sees inserted is what will still be there afterwards.
 *
 * `origin` is the page's own origin. An itinerary copied from one booking and
 * pasted into another arrives as an absolute URL into this application; that is
 * already a stored image, so it is turned back into the relative path the
 * sanitiser accepts and is not re-fetched.
 */
export function collectImageSources(
  doc: Document,
  origin: string,
): CollectedImages {
  const remote = new Set<string>();
  const data = new Set<string>();

  for (const image of [...doc.querySelectorAll("img")]) {
    const src = image.getAttribute("src")?.trim() ?? "";

    if (src === "" || isSpacer(image)) {
      image.remove();
      continue;
    }

    if (DATA_URL.test(src)) {
      // Written back trimmed, so the key collected here is the exact string
      // `applyResolvedSources` will read off the attribute afterwards.
      image.setAttribute("src", src);
      data.add(src);
      continue;
    }

    let url: URL;

    try {
      url = new URL(src);
    } catch {
      // Relative, or not a URL at all. There is no base to resolve it against
      // that would be right in every case, so it goes.
      image.remove();
      continue;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      image.remove();
      continue;
    }

    // One of ours already — rewritten to the stored form and left alone.
    if (url.origin === origin && isInlineImageSrc(url.pathname)) {
      image.setAttribute("src", url.pathname);
      continue;
    }

    // Normalised onto the element as well as into the list: `new URL` can
    // change the spelling — a missing trailing slash, an escaped space — and
    // the two have to agree for the re-hosted path to find its image again.
    const normalised = url.toString();
    image.setAttribute("src", normalised);
    remote.add(normalised);
  }

  return { remote: [...remote], data: [...data] };
}

/**
 * True for an image small enough to be decoration rather than content.
 *
 * Only the attributes are consulted. The document is detached and has never
 * been laid out, so there is nothing else to ask, and a carrier's page states
 * these on the images that have them.
 */
function isSpacer(image: Element): boolean {
  for (const attribute of ["width", "height"]) {
    const value = Number(image.getAttribute(attribute));
    if (Number.isFinite(value) && value > 0 && value < MIN_CONTENT_PIXELS) {
      return true;
    }
  }

  return false;
}

/**
 * Points every image at its re-hosted copy, dropping the ones that failed.
 *
 * Returns how many were dropped, which the editor reports: an itinerary is
 * sometimes nothing but its pictures, and losing one without saying so would
 * leave the operator believing they had pasted a complete record.
 */
export function applyResolvedSources(
  doc: Document,
  resolved: ReadonlyMap<string, string | null>,
): number {
  let dropped = 0;

  for (const image of [...doc.querySelectorAll("img")]) {
    const src = image.getAttribute("src") ?? "";

    // Already a stored path — rewritten by `collectImageSources`.
    if (isInlineImageSrc(src)) continue;

    const replacement = resolved.get(src) ?? null;

    if (replacement === null) {
      image.remove();
      dropped += 1;
      continue;
    }

    image.setAttribute("src", replacement);

    // `srcset` is a second place the original URL hides, and a browser prefers
    // it over `src`. The sanitiser would drop the attribute on save, so left
    // in place it would show the carrier's image until the first reload and
    // the re-hosted one after — the confusing half-failure this whole path is
    // meant to remove.
    image.removeAttribute("srcset");
    image.removeAttribute("loading");
  }

  return dropped;
}

/**
 * Turns a `data:` image into a file the upload route accepts, or null.
 *
 * Null for a type outside the allow-list — an SVG most often, which is an XML
 * document that can carry script and is refused for that reason on every other
 * path into storage too.
 */
export function dataUrlToFile(dataUrl: string, index: number): File | null {
  const match = DATA_URL.exec(dataUrl);
  if (!match?.[1] || !match[2]) return null;

  // `image/jpg` is not a real media type but is what some clipboards write.
  const type = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();

  if (!ALLOWED_IMAGE_TYPES.has(type)) return null;

  let binary: string;

  try {
    binary = atob(match[2].replace(/\s+/g, ""));
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  return new File([bytes], `pasted-${index + 1}.${IMAGE_EXTENSIONS[type]}`, {
    type,
  });
}
