import { afterEach, describe, expect, it, vi } from "vitest";

// `lookupIp` is deliberately not imported here: each case below re-imports the
// module under a fresh environment, because `getEnv` caches on first read.
import { isPrivateAddress } from "@/lib/geo/ip-lookup";

/**
 * IP geolocation.
 *
 * The contract under test is a negative one: this module must never throw and
 * never reject, because it runs in the middle of recording a customer's
 * signature and a geolocation provider having a bad day cannot be allowed to
 * cost them one. Every failure mode below has to come back as `null`.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** `getEnv` caches, so each case re-imports the module under a fresh env. */
async function withProvider(provider: string) {
  vi.stubEnv("GEOIP_PROVIDER", provider);
  vi.resetModules();
  return import("@/lib/geo/ip-lookup");
}

describe("isPrivateAddress", () => {
  it("rejects loopback and the RFC1918 ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.10",
      "172.16.9.9",
      "172.31.255.255",
      "169.254.1.1",
      "100.64.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "fd00::1",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("accepts public addresses", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "192.167.0.1", "203.0.113.5"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("treats an empty or unparseable address as private", () => {
    expect(isPrivateAddress("")).toBe(true);
    expect(isPrivateAddress("   ")).toBe(true);
  });
});

describe("lookupIp", () => {
  it("returns null when no provider is configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { lookupIp: lookup } = await withProvider("none");

    await expect(lookup("8.8.8.8")).resolves.toBeNull();
    // Not merely null — nothing was asked. A disabled provider costs nothing.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null for a missing or private address without calling out", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { lookupIp: lookup } = await withProvider("ipapi");

    await expect(lookup(null)).resolves.toBeNull();
    await expect(lookup("127.0.0.1")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flattens a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            city: "Leeds",
            region: "England",
            country_name: "United Kingdom",
          }),
          { status: 200 },
        ),
      ),
    );

    const { lookupIp: lookup } = await withProvider("ipapi");
    const result = await lookup("8.8.8.8");

    expect(result).toMatchObject({
      city: "Leeds",
      region: "England",
      country: "United Kingdom",
      provider: "ipapi",
    });
    // The response is kept as returned, so a disputed reading can be re-read.
    expect(result?.raw).toMatchObject({ city: "Leeds" });
  });

  it("returns null when the provider rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 429 })),
    );

    const { lookupIp: lookup } = await withProvider("ipapi");

    await expect(lookup("8.8.8.8")).resolves.toBeNull();
  });

  it("returns null for a 200 that carries an error body", async () => {
    // ipapi.co answers 200 with `{ error: true }` when rate limited, so a
    // successful status is not on its own a successful lookup.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: true, reason: "RateLimited" }),
          { status: 200 },
        ),
      ),
    );

    const { lookupIp: lookup } = await withProvider("ipapi");

    await expect(lookup("8.8.8.8")).resolves.toBeNull();
  });

  it("returns null when the response locates nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ ip: "8.8.8.8" }), { status: 200 })),
    );

    const { lookupIp: lookup } = await withProvider("ipapi");

    await expect(lookup("8.8.8.8")).resolves.toBeNull();
  });

  it("swallows a thrown transport error rather than rejecting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ETIMEDOUT")),
    );

    const { lookupIp: lookup } = await withProvider("ipapi");

    await expect(lookup("8.8.8.8")).resolves.toBeNull();
  });

  it("swallows a malformed body rather than rejecting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
    );

    const { lookupIp: lookup } = await withProvider("ipapi");

    await expect(lookup("8.8.8.8")).resolves.toBeNull();
  });
});
