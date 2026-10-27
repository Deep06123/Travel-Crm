import { describe, expect, it } from "vitest";

import { BookingPriority } from "@/generated/prisma/enums";
import { derivePriority } from "@/lib/bookings/priority";

/**
 * Priority is derived rather than chosen, so the thresholds are the whole
 * behaviour — including the boundaries, which is where an off-by-one would
 * quietly mis-sort the high-priority queue.
 */

const NOW = new Date("2026-10-28T12:00:00Z");

/** `days` from NOW, at the same time of day. */
function inDays(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1_000);
}

describe("derivePriority", () => {
  it("treats travel within a week as urgent", () => {
    expect(derivePriority(inDays(0), NOW)).toBe(BookingPriority.URGENT);
    expect(derivePriority(inDays(1), NOW)).toBe(BookingPriority.URGENT);
    expect(derivePriority(inDays(7), NOW)).toBe(BookingPriority.URGENT);
  });

  it("treats travel within a month as high", () => {
    expect(derivePriority(inDays(8), NOW)).toBe(BookingPriority.HIGH);
    expect(derivePriority(inDays(30), NOW)).toBe(BookingPriority.HIGH);
  });

  it("treats travel within a quarter as normal", () => {
    expect(derivePriority(inDays(31), NOW)).toBe(BookingPriority.NORMAL);
    expect(derivePriority(inDays(90), NOW)).toBe(BookingPriority.NORMAL);
  });

  it("treats travel beyond a quarter as low", () => {
    expect(derivePriority(inDays(91), NOW)).toBe(BookingPriority.LOW);
    expect(derivePriority(inDays(400), NOW)).toBe(BookingPriority.LOW);
  });

  it("treats travel already past as urgent", () => {
    // If a booking in the past still needs attention, it needs it now — it
    // must not sink to the bottom of the queue.
    expect(derivePriority(inDays(-1), NOW)).toBe(BookingPriority.URGENT);
    expect(derivePriority(inDays(-365), NOW)).toBe(BookingPriority.URGENT);
  });

  it("falls back to normal when no travel date is recorded", () => {
    // Nothing is known about urgency, so neither extreme would be honest.
    expect(derivePriority(null, NOW)).toBe(BookingPriority.NORMAL);
    expect(derivePriority(undefined, NOW)).toBe(BookingPriority.NORMAL);
  });
});
