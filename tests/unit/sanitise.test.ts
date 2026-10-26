import { describe, expect, it } from "vitest";

import { sanitiseRichText } from "@/lib/html/sanitise";

/**
 * The itinerary editor is the only place this application keeps user markup as
 * markup rather than escaping it, so this is the boundary that stops a crafted
 * itinerary running in an administrator's session — on an origin where that
 * session can read passport numbers and approve refunds.
 *
 * The cases below are the shapes that actually get used against sanitisers:
 * not just `<script>`, which everyone blocks, but the event handler, the
 * `javascript:` URL, the SVG payload and the style that escapes its container.
 */

describe("sanitiseRichText", () => {
  it("keeps the formatting an itinerary needs", () => {
    const clean = sanitiseRichText(
      "<p><strong>LHR</strong> → <em>JFK</em></p><ul><li>14 Nov</li></ul>",
    );

    expect(clean).toContain("<strong>LHR</strong>");
    expect(clean).toContain("<em>JFK</em>");
    expect(clean).toContain("<li>14 Nov</li>");
  });

  it("removes a script tag and its contents", () => {
    const clean = sanitiseRichText("<p>Hi</p><script>alert(document.cookie)</script>");

    expect(clean).toBe("<p>Hi</p>");
    expect(clean).not.toContain("alert");
  });

  it("removes event handler attributes", () => {
    const clean = sanitiseRichText('<p onclick="steal()">Itinerary</p>');

    expect(clean).not.toContain("onclick");
    expect(clean).toContain("Itinerary");
  });

  it("removes a javascript: link but keeps the text", () => {
    const clean = sanitiseRichText('<a href="javascript:alert(1)">Click</a>');

    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("Click");
  });

  it("removes a data: URL", () => {
    const clean = sanitiseRichText(
      '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
    );

    expect(clean).not.toContain("data:");
  });

  it("drops img entirely, so no remote callback is possible", () => {
    const clean = sanitiseRichText(
      '<p>Trip</p><img src="https://tracker.example/pixel.gif">',
    );

    expect(clean).not.toContain("<img");
    expect(clean).not.toContain("tracker.example");
  });

  it("drops iframe, object and embed", () => {
    const clean = sanitiseRichText(
      '<iframe src="https://evil.example"></iframe>' +
        '<object data="x"></object><embed src="y">',
    );

    expect(clean ?? "").not.toContain("iframe");
    expect(clean ?? "").not.toContain("object");
    expect(clean ?? "").not.toContain("embed");
  });

  it("keeps alignment but strips a style that would escape its container", () => {
    const clean = sanitiseRichText(
      '<p style="text-align:center;position:fixed;top:0;left:0;width:100vw">x</p>',
    );

    expect(clean).toContain("text-align:center");
    expect(clean).not.toContain("position");
    expect(clean).not.toContain("100vw");
  });

  it("strips url() from styles, which would fetch a remote resource", () => {
    const clean = sanitiseRichText(
      '<p style="background-color:url(https://evil.example/x)">x</p>',
    );

    expect(clean).not.toContain("evil.example");
  });

  it("forces rel and target on surviving links", () => {
    const clean = sanitiseRichText('<a href="https://example.com">Carrier</a>');

    expect(clean).toContain('rel="noopener noreferrer nofollow"');
    expect(clean).toContain('target="_blank"');
  });

  it("returns null for empty, blank and tag-only input", () => {
    expect(sanitiseRichText(null)).toBeNull();
    expect(sanitiseRichText(undefined)).toBeNull();
    expect(sanitiseRichText("")).toBeNull();

    // An untouched editor still submits something; storing it would make an
    // empty field look filled.
    expect(sanitiseRichText("<p></p>")).toBeNull();
    expect(sanitiseRichText("<p><br></p>")).toBeNull();
    expect(sanitiseRichText("<p>&nbsp;</p>")).toBeNull();
  });

  it("keeps tables, which itineraries are often pasted as", () => {
    const clean = sanitiseRichText(
      "<table><tbody><tr><td>EK507</td><td>BOM</td></tr></tbody></table>",
    );

    expect(clean).toContain("<table>");
    expect(clean).toContain("<td>EK507</td>");
  });
});

/**
 * Images are allowed only when this application issued the `src`.
 *
 * The valid shape is the serving route plus a key exactly as
 * `generateStorageKey` produces it. Everything else is a URL somebody else
 * controls, and an image is the quietest way to make a booking page call out
 * to a third party every time it is opened.
 */
const OWN_IMAGE = `/api/admin/bookings/images/itinerary-images/2026/10/${"a".repeat(48)}.png`;

describe("sanitiseRichText — images", () => {
  it("keeps an image this application stored", () => {
    const clean = sanitiseRichText(`<p>Seat map</p><img src="${OWN_IMAGE}" alt="Seat map">`);

    expect(clean).toContain("<img");
    expect(clean).toContain(OWN_IMAGE);
    expect(clean).toContain('alt="Seat map"');
  });

  it("drops a remote image entirely", () => {
    const clean = sanitiseRichText(
      '<p>Trip</p><img src="https://tracker.example/pixel.gif">',
    );

    expect(clean).not.toContain("<img");
    expect(clean).not.toContain("tracker.example");
    expect(clean).toContain("Trip");
  });

  it("drops a data: image, which would also overflow the column", () => {
    const clean = sanitiseRichText(
      '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==">',
    );

    expect(clean ?? "").not.toContain("<img");
    expect(clean ?? "").not.toContain("data:");
  });

  it("drops a protocol-relative image", () => {
    const clean = sanitiseRichText('<p>x</p><img src="//evil.example/p.gif">');

    expect(clean).not.toContain("<img");
    expect(clean).not.toContain("evil.example");
  });

  it("drops a traversal dressed up as our own path", () => {
    const clean = sanitiseRichText(
      '<p>x</p><img src="/api/admin/bookings/images/../../../etc/passwd">',
    );

    expect(clean).not.toContain("<img");
  });

  it("drops a path that looks right but has the wrong key shape", () => {
    const clean = sanitiseRichText(
      '<p>x</p><img src="/api/admin/bookings/images/itinerary-images/2026/10/short.png">',
    );

    expect(clean).not.toContain("<img");
  });

  it("strips srcset, which is a second place a URL can hide", () => {
    const clean = sanitiseRichText(
      `<img src="${OWN_IMAGE}" srcset="https://evil.example/2x.png 2x">`,
    );

    expect(clean).toContain("<img");
    expect(clean).not.toContain("srcset");
    expect(clean).not.toContain("evil.example");
  });

  it("strips an event handler from an otherwise valid image", () => {
    const clean = sanitiseRichText(`<img src="${OWN_IMAGE}" onerror="steal()">`);

    expect(clean).toContain("<img");
    expect(clean).not.toContain("onerror");
  });

  it("refuses an SVG, which can carry script", () => {
    const clean = sanitiseRichText(
      `<img src="/api/admin/bookings/images/itinerary-images/2026/10/${"b".repeat(48)}.svg">`,
    );

    expect(clean ?? "").not.toContain("<img");
  });
});
