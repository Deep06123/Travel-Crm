import { existsSync } from "node:fs";
import { join } from "node:path";

import * as icons from "lucide-react";
import { describe, expect, it } from "vitest";

import { NAV_SECTIONS } from "@/components/layout/navigation";
import { PERMISSION_DEFINITIONS } from "@/lib/permissions/catalog";

/**
 * Navigation integrity.
 *
 * The sidebar previously advertised modules whose pages did not exist, so
 * clicking them produced a 404. These tests make that a build-time failure: a
 * navigable entry must resolve to a real route file, and an entry that is only
 * planned must say so and therefore render as a non-link.
 */

const APP_DIR = join(process.cwd(), "src", "app");

/**
 * Resolves an admin href to the page file that would serve it.
 *
 * Authenticated pages live inside the `(dashboard)` route group, which does not
 * appear in the URL, so both spellings are accepted.
 */
function routeFileExists(href: string): boolean {
  const path = href.replace(/^\//, "").replace(/\?.*$/, "");
  const segments = path.split("/");

  const candidates = [
    join(APP_DIR, ...segments, "page.tsx"),
    // "/admin/bookings" → src/app/admin/(dashboard)/bookings/page.tsx
    join(APP_DIR, segments[0] ?? "", "(dashboard)", ...segments.slice(1), "page.tsx"),
  ];

  return candidates.some((candidate) => existsSync(candidate));
}

const allItems = NAV_SECTIONS.flatMap((section) => section.items);

describe("sidebar navigation", () => {
  it("has at least one item", () => {
    expect(allItems.length).toBeGreaterThan(0);
  });

  it("points every navigable entry at a route that exists", () => {
    const broken = allItems
      .filter((item) => item.plannedInPhase === undefined)
      .filter((item) => !routeFileExists(item.href))
      .map((item) => `${item.label} → ${item.href}`);

    expect(broken).toEqual([]);
  });

  it("marks every entry whose route is missing as planned", () => {
    const unmarked = allItems
      .filter((item) => !routeFileExists(item.href))
      .filter((item) => item.plannedInPhase === undefined)
      .map((item) => item.label);

    expect(unmarked).toEqual([]);
  });

  it("does not mark a built route as planned", () => {
    const stale = allItems
      .filter((item) => item.plannedInPhase !== undefined)
      .filter((item) => routeFileExists(item.href))
      .map((item) => `${item.label} (phase ${item.plannedInPhase})`);

    // A page that has landed must have its plannedInPhase removed, otherwise
    // the sidebar keeps it unclickable after it is usable.
    expect(stale).toEqual([]);
  });

  it("uses a known permission key for every entry", () => {
    const known = new Set(PERMISSION_DEFINITIONS.map((definition) => definition.key));
    const unknown = allItems
      .filter((item) => !known.has(item.permission))
      .map((item) => `${item.label} → ${item.permission}`);

    expect(unknown).toEqual([]);
  });

  it("does not list the same destination twice", () => {
    const hrefs = allItems.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("gives every planned entry a phase between 3 and 7", () => {
    for (const item of allItems) {
      if (item.plannedInPhase === undefined) continue;
      expect(item.plannedInPhase).toBeGreaterThanOrEqual(3);
      expect(item.plannedInPhase).toBeLessThanOrEqual(7);
    }
  });

  /**
   * The sidebar resolves `item.icon` out of the Lucide namespace at runtime and
   * falls back to a plain circle when the name is unknown. That fallback is
   * silent: a typo, or a guard that rejects Lucide's `forwardRef` objects,
   * renders every entry as an identical circle and nothing fails. Asserting the
   * names resolve turns both mistakes into a failing test.
   */
  it("names an icon that Lucide actually exports, for every entry", () => {
    const registry = icons as unknown as Record<string, unknown>;

    const unresolved = allItems
      .filter((item) => {
        const candidate = registry[item.icon];
        if (typeof candidate === "function") return false;
        return !(
          typeof candidate === "object" &&
          candidate !== null &&
          "$$typeof" in candidate
        );
      })
      .map((item) => `${item.label} → ${item.icon}`);

    expect(unresolved).toEqual([]);
  });
});
