import { beforeEach, describe, expect, it, vi } from "vitest";

import { ObjectNotFoundError } from "@/lib/storage/types";

/**
 * Carrying the composed itinerary into a customer email.
 *
 * The behaviour under test is not the markup so much as the relocation: an
 * itinerary's images are stored behind an administrator-only route, and an
 * email that merely repeated that `src` would reach the customer with its
 * images broken — which on a booking whose itinerary is a screenshot of the
 * carrier's ticket means reaching them with nothing at all.
 */

const get = vi.fn<(key: string) => Promise<Buffer>>();

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getStorage: () => ({ name: "test", get, put: vi.fn(), delete: vi.fn(), exists: vi.fn() }),
}));

const { prepareItineraryForEmail, prepareItineraryForPreview } = await import(
  "@/lib/mail/inline-itinerary"
);

/** A `src` shaped exactly as `generateStorageKey` produces one. */
const KEY = `itinerary-images/2026/11/${"a1b2c3d4".repeat(6)}.png`;
const SRC = `/api/admin/bookings/images/${KEY}`;
const SECOND_KEY = `itinerary-images/2026/11/${"f9e8d7c6".repeat(6)}.jpg`;
const SECOND_SRC = `/api/admin/bookings/images/${SECOND_KEY}`;

const PIXEL = Buffer.from("fake-png-bytes");

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue(PIXEL);
});

describe("prepareItineraryForEmail", () => {
  it("attaches each image and points the body at the attachment", async () => {
    const { html, attachments } = await prepareItineraryForEmail(
      `<p>Depart 09:40</p><img src="${SRC}" alt="ticket">`,
    );

    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.content).toBe(PIXEL);
    expect(attachments[0]?.contentType).toBe("image/png");

    // The body must reference the attachment, and must no longer carry the
    // administrator-only path that would have failed in a mailbox.
    expect(html).toContain(`src="cid:${attachments[0]?.cid}"`);
    expect(html).not.toContain("/api/admin/bookings/images");
    expect(html).toContain("Depart 09:40");
  });

  it("attaches an image referenced twice only once", async () => {
    const { html, attachments } = await prepareItineraryForEmail(
      `<img src="${SRC}"><p>and again</p><img src="${SRC}">`,
    );

    expect(attachments).toHaveLength(1);
    // Both references still resolve, to the same part.
    expect(html?.match(/cid:/g)).toHaveLength(2);
  });

  it("keeps distinct images apart", async () => {
    const { attachments } = await prepareItineraryForEmail(
      `<img src="${SRC}"><img src="${SECOND_SRC}">`,
    );

    expect(attachments).toHaveLength(2);
    expect(attachments[0]?.cid).not.toBe(attachments[1]?.cid);
    expect(attachments.map((a) => a.contentType)).toEqual([
      "image/png",
      "image/jpeg",
    ]);
  });

  it("drops an image that is no longer in storage, keeping the rest", async () => {
    get.mockRejectedValueOnce(new ObjectNotFoundError(KEY));

    const { html, attachments } = await prepareItineraryForEmail(
      `<p>Seat 14A</p><img src="${SRC}">`,
    );

    // The email still goes, with the text intact and no broken-image icon.
    expect(attachments).toHaveLength(0);
    expect(html).toContain("Seat 14A");
    expect(html).not.toContain("<img");
  });

  it("constrains an oversized image to the width of the message", async () => {
    const { html } = await prepareItineraryForEmail(`<img src="${SRC}">`);

    // Mail clients do not shrink a wide screenshot on their own; they widen
    // the table and push the text off screen instead.
    expect(html).toContain("max-width:100%");
  });

  it("returns nothing for a booking with no itinerary", async () => {
    expect(await prepareItineraryForEmail(null)).toEqual({
      html: null,
      attachments: [],
    });
    expect(await prepareItineraryForEmail("   ")).toEqual({
      html: null,
      attachments: [],
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("does not read storage for an itinerary that is only text", async () => {
    const { html, attachments } = await prepareItineraryForEmail(
      "<p>Check in at the counter.</p>",
    );

    expect(attachments).toEqual([]);
    expect(html).toBe("<p>Check in at the counter.</p>");
    expect(get).not.toHaveBeenCalled();
  });
});

describe("prepareItineraryForPreview", () => {
  it("inlines the image, because the preview frame cannot fetch one", async () => {
    const html = await prepareItineraryForPreview(`<img src="${SRC}">`);

    // The preview renders in a `sandbox=""` iframe: an opaque origin that
    // sends no cookies and resolves no relative path.
    expect(html).toContain(`data:image/png;base64,${PIXEL.toString("base64")}`);
    expect(html).not.toContain("/api/admin/bookings/images");
  });

  it("returns null when there is no itinerary", async () => {
    expect(await prepareItineraryForPreview(null)).toBeNull();
  });
});
