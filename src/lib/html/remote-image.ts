import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "./inline-image";

/**
 * Fetches an image the operator pasted a reference to, so it can be re-hosted.
 *
 * An itinerary is most often copied straight off the carrier's own booking
 * page, and what lands on the clipboard is markup pointing at that carrier's
 * images. The sanitiser refuses those `src` values on purpose — see
 * `inline-image.ts` — because a remote image left in a stored booking reports
 * to whoever supplied it every time a member of staff opens the record.
 *
 * Re-hosting resolves that without weakening the rule: the bytes are fetched
 * once, at paste time, stored like any other upload, and the markup that gets
 * saved refers only to this application. Nothing calls out when the booking is
 * later viewed or emailed.
 *
 * It does mean the server now makes a request to a URL a user chose, which it
 * has never done anywhere else. That is the dangerous part, and the guards
 * below are the point of this module rather than an afterthought:
 *
 *   * `http`/`https` only — no `file:`, no `gopher:`, nothing that addresses
 *     something other than a web document.
 *   * Every resolved address is checked against the private, loopback,
 *     link-local and reserved ranges before a connection is made. Without this
 *     the route is a probe into whatever network the server sits on: cloud
 *     metadata at 169.254.169.254, a database on 10.x, an admin panel on
 *     localhost.
 *   * Redirects are followed by hand, three at most, with the same check
 *     applied to each hop. A public host that redirects to 127.0.0.1 is the
 *     standard way around a check that only looks at the URL it was given.
 *   * A timeout and a byte cap, both enforced while reading rather than from
 *     the headers, so a slow trickle or a lying `Content-Length` cannot hold a
 *     request open or exhaust memory.
 *   * The stored type comes from the bytes' own magic number, not from the
 *     `Content-Type` the remote host claimed. A host controls both, and the
 *     declared type is what the serving route would later label it with.
 *
 * Residual risk, stated rather than hidden: the address is validated and then
 * the connection is made by name, so a hostname whose DNS answer changes
 * between the two has a narrow window. Closing it needs a custom dispatcher
 * that connects to the address already validated. It is left open because the
 * caller of this module is an authenticated operator with `booking.update` —
 * someone who can already reach far more of this application directly than a
 * single blind image fetch would give them.
 */

/** How long one hop may take before it is abandoned. */
const FETCH_TIMEOUT_MS = 8_000;

/** Redirect hops followed before giving up. */
const MAX_REDIRECTS = 3;

/** An import that failed for a reason worth showing the operator. */
export class RemoteImageError extends Error {}

export interface RemoteImage {
  buffer: Buffer;
  /** From the bytes themselves — see the note on magic numbers above. */
  contentType: string;
}

/**
 * True for an address that must never be connected to.
 *
 * Written as an allow-nothing list of ranges rather than "is it public",
 * because the failure direction matters: an address this does not recognise is
 * refused by the caller only if listed here, so the ranges that reach
 * infrastructure are enumerated explicitly.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);

  // Not an address at all. Refusing is the safe answer for a value that was
  // supposed to be one.
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n))) {
    return true;
  }

  const [a, b] = octets as [number, number, number, number];

  // 0.0.0.0/8 — "this network"; 0.0.0.0 itself routes to localhost on Linux.
  if (a === 0) return true;
  // 10.0.0.0/8 — private.
  if (a === 10) return true;
  // 127.0.0.0/8 — loopback.
  if (a === 127) return true;
  // 100.64.0.0/10 — carrier-grade NAT, routinely used inside cloud networks.
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 169.254.0.0/16 — link-local, and where cloud instance metadata lives.
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — private, the default Docker bridge range included.
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — private.
  if (a === 192 && b === 168) return true;
  // 192.0.0.0/24 and 192.0.2.0/24 — IETF protocol assignments, documentation.
  if (a === 192 && b === 0) return true;
  // 192.88.99.0/24 — deprecated 6to4 relay anycast.
  if (a === 192 && b === 88) return true;
  // 198.18.0.0/15 — benchmarking.
  if (a === 198 && b >= 18 && b <= 19) return true;
  // 198.51.100.0/24 and 203.0.113.0/24 — documentation.
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved, broadcast included.
  if (a >= 224) return true;

  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalised = address.toLowerCase().split("%")[0] ?? "";

  // An IPv4 address wearing an IPv6 suit — `::ffff:127.0.0.1` reaches loopback
  // exactly as the bare form does, so it is judged by its embedded address.
  const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(normalised);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);

  // The same address written as hex rather than dotted quad.
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalised);
  if (hexMapped?.[1] && hexMapped[2]) {
    const high = Number.parseInt(hexMapped[1], 16);
    const low = Number.parseInt(hexMapped[2], 16);
    return isBlockedIpv4(
      [high >> 8, high & 0xff, low >> 8, low & 0xff].join("."),
    );
  }

  // :: (unspecified) and ::1 (loopback).
  if (normalised === "::" || normalised === "::1") return true;

  const head = normalised.split(":")[0] ?? "";
  const leading = Number.parseInt(head.padStart(4, "0"), 16);
  if (!Number.isInteger(leading)) return true;

  // fc00::/7 — unique local. fe80::/10 — link-local. ff00::/8 — multicast.
  if ((leading & 0xfe00) === 0xfc00) return true;
  if ((leading & 0xffc0) === 0xfe80) return true;
  if ((leading & 0xff00) === 0xff00) return true;

  // 2002::/16 — 6to4, which embeds an IPv4 address in the next 32 bits.
  if (leading === 0x2002) {
    const parts = normalised.split(":");
    const high = Number.parseInt(parts[1] ?? "0", 16);
    const low = Number.parseInt(parts[2] ?? "0", 16);
    return isBlockedIpv4(
      [high >> 8, high & 0xff, low >> 8, low & 0xff].join("."),
    );
  }

  return false;
}

/**
 * Parses a URL and refuses it unless every address it resolves to is routable.
 *
 * Every address, not the first: a hostname with both a public and a private A
 * record is a deliberate shape, and connecting by name would pick either.
 */
async function assertFetchable(raw: string): Promise<URL> {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new RemoteImageError("That image address could not be read.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RemoteImageError("Only http and https images can be imported.");
  }

  // A bare address needs no lookup, and `dns.lookup` on one would simply hand
  // it back — checked directly so the intent is visible.
  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new RemoteImageError("That image is on a non-public address.");
    }
    return url;
  }

  let addresses: { address: string }[];

  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new RemoteImageError("That image's host could not be found.");
  }

  if (addresses.length === 0) {
    throw new RemoteImageError("That image's host could not be found.");
  }

  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new RemoteImageError("That image is on a non-public address.");
  }

  return url;
}

/**
 * The image type the bytes actually are, or null.
 *
 * Only the four formats the upload route accepts are recognised, so anything
 * else — an HTML error page served as `image/png`, an SVG, a zip — has no type
 * to be stored under and is refused by the caller.
 */
export function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;

  // \x89PNG\r\n\x1a\n
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: SOI marker.
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF87a / GIF89a.
  if (bytes.subarray(0, 6).toString("latin1").match(/^GIF8[79]a$/)) {
    return "image/gif";
  }

  // RIFF....WEBP
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Reads a body, abandoning it the moment it exceeds the cap.
 *
 * Streamed rather than buffered whole: `Content-Length` is a claim by the
 * remote host, and a response without one could otherwise be read until memory
 * ran out.
 */
async function readCapped(response: Response, limit: number): Promise<Buffer> {
  const body = response.body;
  if (!body) throw new RemoteImageError("That image returned nothing.");

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;

      if (total > limit) {
        throw new RemoteImageError(
          `That image is larger than the ${limit / 1024 / 1024}MB limit.`,
        );
      }

      chunks.push(value);
    }
  } finally {
    // Releases the socket on the error paths too, which matters when several
    // imports are in flight for one paste.
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks, total);
}

/**
 * Fetches one image, following redirects by hand so each hop is re-checked.
 *
 * Throws `RemoteImageError` with a message fit to show an operator; the caller
 * reports it against the image that failed and keeps the rest of the paste.
 */
export async function fetchRemoteImage(raw: string): Promise<RemoteImage> {
  let target = await assertFetchable(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;

    try {
      response = await fetch(target, {
        // Manual, because `follow` would connect to the redirect target
        // without any of the checks above ever seeing it.
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          Accept: [...ALLOWED_IMAGE_TYPES].join(","),
          // Some carrier CDNs serve a placeholder or a 403 to a client that
          // sends no referer at all.
          "User-Agent": "Mozilla/5.0 (compatible; itinerary-image-import)",
        },
        // No cookies, no credentials — this is not the operator's browser and
        // must not act as if it were.
        credentials: "omit",
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new RemoteImageError("That image took too long to download.");
      }
      throw new RemoteImageError("That image could not be downloaded.");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);

      if (!location) {
        throw new RemoteImageError("That image could not be downloaded.");
      }

      if (hop === MAX_REDIRECTS) {
        throw new RemoteImageError("That image redirected too many times.");
      }

      // Resolved against the hop it came from, then put through the same
      // address check as the original URL.
      target = await assertFetchable(new URL(location, target).toString());
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new RemoteImageError(
        `That image could not be downloaded (${response.status}).`,
      );
    }

    const buffer = await readCapped(response, MAX_IMAGE_BYTES);

    if (buffer.byteLength === 0) {
      throw new RemoteImageError("That image is empty.");
    }

    const contentType = sniffImageType(buffer);

    if (!contentType) {
      throw new RemoteImageError(
        "That address is not a PNG, JPEG, WebP or GIF image.",
      );
    }

    return { buffer, contentType };
  }

  throw new RemoteImageError("That image redirected too many times.");
}
