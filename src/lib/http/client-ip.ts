/**
 * The address a request actually came from.
 *
 * `X-Forwarded-For` is the only way to see past a reverse proxy and it is also
 * a header the client writes first. A browser is free to send
 * `X-Forwarded-For: 203.0.113.9`; nginx appends the real peer to it, and the
 * list that arrives reads `203.0.113.9, <real client>`. Reading the leftmost
 * entry — the conventional advice, and what this application did before —
 * therefore records whatever the signer typed into their own request.
 *
 * For an analytics counter that hardly matters. For the IP address printed on
 * a signed authorization it is the whole point: the value is evidence only
 * because the server observed it rather than being told it.
 *
 * So the chain is read from the right. The rightmost entry was written by the
 * proxy nearest this process, the one before it by the proxy before that, and
 * so on; `TRUSTED_PROXY_HOPS` says how many of those are infrastructure under
 * this deployment's control. Everything further left is client-supplied and is
 * discarded.
 *
 * Deliberately free of `server-only` and of any import from `@/lib/env`: the
 * parsing is pure and worth testing on its own, and the caller passes the hop
 * count in.
 */

/** Minimal shape, so this can be tested without constructing a Headers object. */
export interface HeaderSource {
  get(name: string): string | null;
}

/**
 * An IPv4 or IPv6 literal, with any port or IPv6 brackets removed.
 *
 * Validated rather than stored as-is because this value is printed into a PDF,
 * an email and a geolocation request. A proxy that has been misconfigured — or
 * an unknown one that writes `unknown` or `_hidden`, both of which RFC 7239
 * permits — must leave the field empty rather than fill it with a token that
 * reads like an address.
 */
export function normalizeIp(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  // `[2001:db8::1]:443` — the bracketed form, which only ever appears with a
  // port. Taken before the IPv4 case so the colons inside are not mistaken for
  // a port separator.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(raw)?.[1];
  const candidate = bracketed ?? stripIpv4Port(raw);

  if (isIpv4(candidate)) return candidate;
  if (isIpv6(candidate)) return candidate.toLowerCase();

  return null;
}

/** `203.0.113.9:51234` → `203.0.113.9`. Leaves a bare IPv6 alone. */
function stripIpv4Port(value: string): string {
  // Exactly one colon means IPv4-with-port; more than one is IPv6, which uses
  // colons as its own separator and carries no port unbracketed.
  const parts = value.split(":");

  return parts.length === 2 && parts[0]!.includes(".") ? parts[0]! : value;
}

function isIpv4(value: string): boolean {
  const octets = value.split(".");
  if (octets.length !== 4) return false;

  return octets.every((octet) => {
    // Rejects `01`, `+1` and the empty string, each of which `Number` accepts
    // or coerces in a way that would let a malformed address through.
    if (!/^\d{1,3}$/.test(octet)) return false;
    if (octet.length > 1 && octet.startsWith("0")) return false;

    return Number(octet) <= 255;
  });
}

function isIpv6(value: string): boolean {
  // The zone index on a link-local address (`fe80::1%eth0`) is local to the
  // machine that wrote it and means nothing here.
  const address = value.split("%")[0]!;

  if (!address.includes(":")) return false;
  if (!/^[0-9a-fA-F:.]+$/.test(address)) return false;

  // At most one `::`, and it is the only way a group may be empty.
  const doubleColons = address.split("::").length - 1;
  if (doubleColons > 1) return false;

  const groups = address.split(":");
  if (groups.length > 8) return false;
  if (doubleColons === 0 && groups.length !== 8) return false;

  return groups.every((group, index) => {
    if (group === "") return true;

    // A trailing IPv4 part, as in `::ffff:192.0.2.1`, is only valid last.
    if (group.includes(".")) {
      return index === groups.length - 1 && isIpv4(group);
    }

    return /^[0-9a-fA-F]{1,4}$/.test(group);
  });
}

export interface ClientIpOptions {
  /**
   * How many right-hand `X-Forwarded-For` entries this deployment's own
   * proxies wrote. `0` distrusts the header entirely.
   */
  trustedHops: number;
}

/**
 * Picks the client address out of the forwarding headers.
 *
 * Returns `null` rather than guessing. A signature with no recorded address is
 * an honest gap; one carrying an address the signer chose is a false record,
 * and the second is much worse than the first.
 */
export function clientIpFrom(
  headers: HeaderSource,
  { trustedHops }: ClientIpOptions,
): string | null {
  if (trustedHops <= 0) {
    // Nothing in front of us, so the only trustworthy source is the socket —
    // which the Web `Request` does not expose. Better null than a header.
    return null;
  }

  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (chain.length > 0) {
    // The rightmost entry was written by the nearest proxy, the one before it
    // by the proxy before that. Stepping back `trustedHops` entries lands on
    // the address the outermost trusted proxy observed — the client.
    const index = chain.length - trustedHops;

    // A chain shorter than the configured hop count means a request that did
    // not come through the expected path. The leftmost entry is then the
    // furthest-out thing the proxies themselves wrote, so it is as good as
    // this gets; `normalizeIp` still refuses anything malformed.
    return normalizeIp(chain[Math.max(index, 0)]);
  }

  // Single-value headers, written by the proxy rather than forwarded, so there
  // is no chain to walk. Only consulted when there is a trusted proxy at all.
  return (
    normalizeIp(headers.get("x-real-ip")) ??
    normalizeIp(headers.get("cf-connecting-ip"))
  );
}
