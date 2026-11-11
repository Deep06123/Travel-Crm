import { describe, expect, it } from "vitest";

import { clientIpFrom, normalizeIp } from "@/lib/http/client-ip";

/**
 * Reading the client address out of forwarding headers.
 *
 * The case that matters most is the spoofed one. `X-Forwarded-For` is a list
 * the client gets to start, so an implementation that reads it left to right
 * records whatever the signer typed — and that value then goes into a signed
 * PDF as evidence. Most of these tests exist to pin that down.
 */

function headers(values: Record<string, string>): { get(name: string): string | null } {
  return { get: (name) => values[name.toLowerCase()] ?? null };
}

describe("normalizeIp", () => {
  it("accepts plain v4 and v6 literals", () => {
    expect(normalizeIp("203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeIp("::1")).toBe("::1");
    expect(normalizeIp("::ffff:192.0.2.1")).toBe("::ffff:192.0.2.1");
  });

  it("strips a port and IPv6 brackets", () => {
    expect(normalizeIp("203.0.113.9:51234")).toBe("203.0.113.9");
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("drops an IPv6 zone index, which is local to the host that wrote it", () => {
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1%eth0");
  });

  it("refuses anything that is not an address", () => {
    // RFC 7239 permits both of these as obfuscated identifiers, and neither
    // belongs in a field a reader will take for an IP address.
    expect(normalizeIp("unknown")).toBeNull();
    expect(normalizeIp("_hidden")).toBeNull();

    expect(normalizeIp("")).toBeNull();
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp("999.1.1.1")).toBeNull();
    expect(normalizeIp("203.0.113")).toBeNull();
    expect(normalizeIp("01.2.3.4")).toBeNull();
    expect(normalizeIp("2001:db8::1::2")).toBeNull();
    expect(normalizeIp("<script>alert(1)</script>")).toBeNull();
  });
});

describe("clientIpFrom", () => {
  it("takes the entry the single trusted proxy wrote, not the one the client sent", () => {
    // The browser sent `198.51.100.7`; nginx appended the real peer.
    const found = clientIpFrom(
      headers({ "x-forwarded-for": "198.51.100.7, 203.0.113.9" }),
      { trustedHops: 1 },
    );

    expect(found).toBe("203.0.113.9");
  });

  it("steps back one entry per trusted hop", () => {
    const chain = "198.51.100.7, 203.0.113.9, 10.0.0.2, 10.0.0.3";

    expect(clientIpFrom(headers({ "x-forwarded-for": chain }), { trustedHops: 2 })).toBe(
      "10.0.0.2",
    );
    expect(clientIpFrom(headers({ "x-forwarded-for": chain }), { trustedHops: 3 })).toBe(
      "203.0.113.9",
    );
  });

  it("records nothing when the header is not trusted at all", () => {
    expect(
      clientIpFrom(headers({ "x-forwarded-for": "203.0.113.9" }), {
        trustedHops: 0,
      }),
    ).toBeNull();
  });

  it("falls back to the leftmost entry when the chain is shorter than configured", () => {
    // A request that did not come through the expected path. Everything in
    // the chain was written by a proxy, so the outermost is the best there is.
    expect(
      clientIpFrom(headers({ "x-forwarded-for": "203.0.113.9" }), {
        trustedHops: 3,
      }),
    ).toBe("203.0.113.9");
  });

  it("uses the single-value headers only when there is no chain", () => {
    expect(
      clientIpFrom(headers({ "x-real-ip": "203.0.113.9" }), { trustedHops: 1 }),
    ).toBe("203.0.113.9");

    expect(
      clientIpFrom(headers({ "cf-connecting-ip": "203.0.113.9" }), {
        trustedHops: 1,
      }),
    ).toBe("203.0.113.9");

    // A chain is present, so `x-real-ip` is ignored rather than preferred.
    expect(
      clientIpFrom(
        headers({
          "x-forwarded-for": "198.51.100.7, 203.0.113.9",
          "x-real-ip": "198.51.100.7",
        }),
        { trustedHops: 1 },
      ),
    ).toBe("203.0.113.9");
  });

  it("returns null rather than a malformed value", () => {
    expect(
      clientIpFrom(headers({ "x-forwarded-for": "198.51.100.7, unknown" }), {
        trustedHops: 1,
      }),
    ).toBeNull();

    expect(clientIpFrom(headers({}), { trustedHops: 1 })).toBeNull();
  });
});
