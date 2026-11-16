// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  applyResolvedSources,
  collectImageSources,
  dataUrlToFile,
  parsePastedHtml,
} from "@/lib/html/paste-images";

/**
 * What actually arrives when an operator copies an itinerary off a carrier's
 * booking page: markup, with that carrier's image URLs in it and a tracking
 * pixel or two for company. Each of those has to end up either re-hosted here
 * or removed, because the sanitiser will remove anything still pointing
 * elsewhere when the booking is saved — and an image that disappears on save
 * is the failure this path exists to prevent.
 */

const ORIGIN = "https://crm.example";
const STORED = "/api/admin/bookings/images/itinerary-images/2026/11/" + "a".repeat(48) + ".png";

describe("collectImageSources", () => {
  it("lists remote images for import", () => {
    const doc = parsePastedHtml(
      '<p>Wonder of the Seas</p><img src="https://www.royalcaribbean.com/ship.jpg">',
    );

    const { remote } = collectImageSources(doc, ORIGIN);

    expect(remote).toEqual(["https://www.royalcaribbean.com/ship.jpg"]);
  });

  it("lists data: images separately, since their bytes are already here", () => {
    const uri = "data:image/png;base64,iVBORw0KGgo=";
    const doc = parsePastedHtml(`<img src="${uri}">`);

    const { remote, data } = collectImageSources(doc, ORIGIN);

    expect(remote).toEqual([]);
    expect(data).toEqual([uri]);
  });

  it("removes a tracking pixel instead of importing it", () => {
    // The one image on the page whose entire purpose is the callback this
    // module exists to stop.
    const doc = parsePastedHtml(
      '<img src="https://analytics.example/p.gif" width="1" height="1">',
    );

    const { remote } = collectImageSources(doc, ORIGIN);

    expect(remote).toEqual([]);
    expect(doc.querySelectorAll("img")).toHaveLength(0);
  });

  it("removes an image it cannot resolve", () => {
    const doc = parsePastedHtml(
      '<img src="/relative.png"><img src="//cdn.example/x.png"><img src="">',
    );

    const { remote, data } = collectImageSources(doc, ORIGIN);

    expect(remote).toEqual([]);
    expect(data).toEqual([]);
    expect(doc.querySelectorAll("img")).toHaveLength(0);
  });

  it("keeps an image already stored here, as the path the sanitiser accepts", () => {
    // An itinerary copied from one booking and pasted into another.
    const doc = parsePastedHtml(`<img src="${ORIGIN}${STORED}">`);

    const { remote } = collectImageSources(doc, ORIGIN);

    expect(remote).toEqual([]);
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(STORED);
  });

  it("deduplicates, so a logo repeated down the page is fetched once", () => {
    const doc = parsePastedHtml(
      '<img src="https://line.example/logo.png"><img src="https://line.example/logo.png">',
    );

    expect(collectImageSources(doc, ORIGIN).remote).toHaveLength(1);
  });

  it("collects the src exactly as applyResolvedSources will read it back", () => {
    const doc = parsePastedHtml('<img src="  https://line.example  ">');

    const [source] = collectImageSources(doc, ORIGIN).remote;

    expect(source).toBeDefined();
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(source);
  });
});

describe("applyResolvedSources", () => {
  it("repoints an imported image and drops srcset with it", () => {
    // A browser prefers `srcset`, and the sanitiser drops the attribute on
    // save: left in place the carrier's image would show until the first
    // reload and the re-hosted one afterwards.
    const doc = parsePastedHtml(
      '<img src="https://line.example/a.png" srcset="https://line.example/a@2x.png 2x">',
    );

    const dropped = applyResolvedSources(
      doc,
      new Map([["https://line.example/a.png", STORED]]),
    );

    expect(dropped).toBe(0);
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(STORED);
    expect(doc.querySelector("img")?.hasAttribute("srcset")).toBe(false);
  });

  it("removes an image that could not be imported, and counts it", () => {
    const doc = parsePastedHtml(
      '<p>Day 1</p><img src="https://line.example/a.png">',
    );

    const dropped = applyResolvedSources(
      doc,
      new Map([["https://line.example/a.png", null]]),
    );

    expect(dropped).toBe(1);
    expect(doc.querySelectorAll("img")).toHaveLength(0);
    // The itinerary's text is not collateral damage.
    expect(doc.body.innerHTML).toContain("Day 1");
  });

  it("leaves an already-stored image alone", () => {
    const doc = parsePastedHtml(`<img src="${STORED}">`);

    expect(applyResolvedSources(doc, new Map())).toBe(0);
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(STORED);
  });
});

describe("dataUrlToFile", () => {
  it("decodes a PNG into a file named for its type", () => {
    const file = dataUrlToFile("data:image/png;base64,iVBORw0KGgo=", 0);

    expect(file?.type).toBe("image/png");
    expect(file?.name).toBe("pasted-1.png");
    expect(file?.size).toBeGreaterThan(0);
  });

  it("normalises image/jpg, which some clipboards write", () => {
    expect(dataUrlToFile("data:image/jpg;base64,/9j/4AAQ", 0)?.type).toBe("image/jpeg");
  });

  it("refuses an SVG, which is a document that can carry script", () => {
    expect(dataUrlToFile("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", 0)).toBeNull();
  });
});
