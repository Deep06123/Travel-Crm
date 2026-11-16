import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RemoteImageError,
  fetchRemoteImage,
  isBlockedAddress,
  sniffImageType,
} from "@/lib/html/remote-image";

/**
 * Re-hosting an itinerary's images is the one place this application fetches a
 * URL somebody else chose. That makes it the one place a request can be aimed
 * at the network the server sits on rather than at the internet, so these are
 * the cases that matter: the metadata address, the private ranges, the public
 * host that redirects inwards, and a response that claims to be an image.
 */

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function imageResponse(bytes: Buffer, contentType = "image/png"): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("isBlockedAddress", () => {
  it("blocks loopback, private and link-local IPv4", () => {
    // 169.254.169.254 is cloud instance metadata: credentials, in plain text,
    // to anything that can make the server issue a GET.
    for (const address of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "255.255.255.255",
      "224.0.0.1",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public IPv4", () => {
    for (const address of ["8.8.8.8", "104.18.32.7", "172.32.0.1", "11.0.0.1"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("blocks loopback and unique-local IPv6, and the v4 forms hiding in it", () => {
    for (const address of [
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "2002:7f00:0001::",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows public IPv6", () => {
    expect(isBlockedAddress("2606:4700::6810:85e5")).toBe(false);
  });

  it("blocks anything that is not an address at all", () => {
    expect(isBlockedAddress("localhost")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("sniffImageType", () => {
  it("names the four formats from their own bytes", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(
      sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toBe("image/jpeg");
    expect(sniffImageType(Buffer.from("GIF89a................"))).toBe("image/gif");
    expect(sniffImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });

  it("refuses an SVG and an HTML page, whatever they were labelled", () => {
    expect(sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'>"))).toBeNull();
    expect(sniffImageType(Buffer.from("<!DOCTYPE html><html><body>"))).toBeNull();
  });
});

describe("fetchRemoteImage", () => {
  it("refuses a non-http scheme without making a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchRemoteImage("file:///etc/passwd")).rejects.toBeInstanceOf(
      RemoteImageError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a literal private address without making a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      fetchRemoteImage("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(/non-public address/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a redirect that lands on a private address", async () => {
    // The public host passes the first check; the whole point of re-checking
    // each hop is that its answer can point anywhere.
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1:8080/admin" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchRemoteImage("https://8.8.8.8/logo.png")).rejects.toThrow(
      /non-public address/,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses a response whose bytes are not one of the four formats", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        // Labelled an image, and is not one. The label is the part a remote
        // host controls for free.
        imageResponse(Buffer.from("<!DOCTYPE html><html>"), "image/png"),
      ),
    );

    await expect(fetchRemoteImage("https://8.8.8.8/logo.png")).rejects.toThrow(
      /not a PNG/,
    );
  });

  it("returns the bytes and the sniffed type for a real image", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse(PNG, "image/webp")));

    const image = await fetchRemoteImage("https://8.8.8.8/logo.png");

    expect(image.contentType).toBe("image/png");
    expect(image.buffer.equals(PNG)).toBe(true);
  });

  it("gives up rather than following a redirect loop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: "https://8.8.8.8/again.png" },
        }),
      ),
    );

    await expect(fetchRemoteImage("https://8.8.8.8/logo.png")).rejects.toThrow(
      /redirected too many times/,
    );
  });

  it("reports a failed download rather than throwing something unhandled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 403 })),
    );

    await expect(fetchRemoteImage("https://8.8.8.8/logo.png")).rejects.toThrow(
      /\(403\)/,
    );
  });
});
