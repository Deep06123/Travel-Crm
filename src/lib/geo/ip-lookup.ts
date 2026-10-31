import "server-only";

import { getEnv } from "@/lib/env";
import { loggerFor } from "@/lib/logging/logger";

/**
 * Approximate location for an IP address.
 *
 * Used as supporting evidence on a customer's e-signature, never as proof: an
 * IP places a request somewhere between the right building and the wrong
 * country depending on the carrier, and a VPN moves it anywhere at all. It
 * corroborates the address that is actually recorded, which is the IP itself.
 *
 * Every function here is best-effort and returns `null` rather than throwing.
 * A geolocation provider being slow, rate-limited or unreachable must not cost
 * a customer their signature — the same reasoning that makes `getMailer()`
 * return `null` instead of failing a booking.
 */

const log = loggerFor("ip-lookup");

/** Long enough for a healthy provider, short enough not to stall the signer. */
const TIMEOUT_MS = 2_000;

export interface IpLocation {
  city: string | null;
  region: string | null;
  country: string | null;
  /** Which service answered, recorded so a disputed reading can be traced. */
  provider: string;
  /** The response as returned, before this module flattened it. */
  raw: Record<string, unknown>;
}

/**
 * True for addresses no public provider can say anything useful about.
 *
 * Covers loopback, link-local, the three RFC1918 ranges, the RFC6598 carrier
 * range, and IPv6 loopback and unique-local. In development every request
 * arrives from one of these, so skipping them also avoids a pointless outbound
 * call on every local signature.
 */
export function isPrivateAddress(ip: string): boolean {
  const value = ip.trim().toLowerCase();
  if (value === "") return true;

  // An IPv4-mapped IPv6 address (::ffff:127.0.0.1) is still that IPv4 address.
  const mapped = value.startsWith("::ffff:") ? value.slice(7) : value;

  if (mapped === "::" || mapped === "::1") return true;
  // fc00::/7 — unique local; fe80::/10 — link local.
  if (/^f[cd]/.test(mapped) || mapped.startsWith("fe8") || mapped.startsWith("fe9")) {
    return true;
  }

  const octets = mapped.split(".");
  if (octets.length !== 4) return false;

  const [a, b] = octets.map((part) => Number.parseInt(part, 10));
  if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) {
    return true;
  }

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;

  return false;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Resolves an IP address to an approximate city, region and country.
 *
 * Returns `null` — never throws, and never rejects — when no provider is
 * configured, the address is private or malformed, the request times out, or
 * the provider answers with anything other than a usable body.
 */
export async function lookupIp(ip: string | null | undefined): Promise<IpLocation | null> {
  const env = getEnv();
  if (env.GEOIP_PROVIDER === "none") return null;

  if (!ip || isPrivateAddress(ip)) return null;

  try {
    const url = new URL(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (env.GEOIP_API_KEY) url.searchParams.set("key", env.GEOIP_API_KEY);

    const response = await fetch(url, {
      // Evidence, not a page: a cached location would be the wrong signer's.
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      log.warn({ ip, status: response.status }, "Geolocation lookup rejected");
      return null;
    }

    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;

    const raw = body as Record<string, unknown>;

    // ipapi.co answers 200 with `{ error: true, reason: "..." }` when rate
    // limited, so a successful status is not on its own a successful lookup.
    if (raw.error) {
      log.warn({ ip, reason: raw.reason }, "Geolocation lookup refused");
      return null;
    }

    const city = text(raw.city);
    const region = text(raw.region);
    const country = text(raw.country_name) ?? text(raw.country);

    // A response that located nothing is not worth storing as a location.
    if (!city && !region && !country) return null;

    return { city, region, country, provider: "ipapi", raw };
  } catch (error) {
    // Includes the AbortError from the timeout. Deliberately swallowed.
    log.warn({ err: error, ip }, "Geolocation lookup failed");
    return null;
  }
}
