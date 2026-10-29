import { describe, expect, it } from "vitest";

import { zonedDayParts, zonedWallClockToUtc } from "@/lib/format";

/**
 * Report date ranges.
 *
 * A report range is a pair of calendar days the operator picked, and they mean
 * those days *in the business timezone*. Getting that wrong is not a cosmetic
 * problem: the range used to be parsed as UTC and then bounded with the
 * server's local hours, which dropped the whole of the chosen end day in any
 * timezone behind UTC. A booking taken on the 20th did not appear in a report
 * that ran to the 20th.
 */

const NY = "America/New_York";

describe("zonedWallClockToUtc", () => {
  it("reads a day as that day in the zone, not as UTC", () => {
    // Midnight on 20 October in New York is 04:00 UTC — not 00:00 UTC, which
    // is what `new Date("2026-10-20")` would have given.
    expect(
      zonedWallClockToUtc(2026, 10, 20, 0, 0, 0, 0, NY).toISOString(),
    ).toBe("2026-10-20T04:00:00.000Z");
  });

  it("puts the end of a day at the last millisecond of it", () => {
    expect(
      zonedWallClockToUtc(2026, 10, 20, 23, 59, 59, 999, NY).toISOString(),
    ).toBe("2026-10-21T03:59:59.999Z");
  });

  it("uses the offset in force on the day, not today's", () => {
    // 15 January is EST (-05:00); 15 July is EDT (-04:00).
    expect(
      zonedWallClockToUtc(2026, 1, 15, 0, 0, 0, 0, NY).toISOString(),
    ).toBe("2026-01-15T05:00:00.000Z");
    expect(
      zonedWallClockToUtc(2026, 7, 15, 0, 0, 0, 0, NY).toISOString(),
    ).toBe("2026-07-15T04:00:00.000Z");
  });

  it("handles the day the clocks go forward", () => {
    // 8 March 2026, 02:00 EST → 03:00 EDT. Midnight is still EST.
    expect(
      zonedWallClockToUtc(2026, 3, 8, 0, 0, 0, 0, NY).toISOString(),
    ).toBe("2026-03-08T05:00:00.000Z");
    // By the end of that day the zone is on EDT, so the day is 23 hours long.
    const start = zonedWallClockToUtc(2026, 3, 8, 0, 0, 0, 0, NY);
    const end = zonedWallClockToUtc(2026, 3, 8, 23, 59, 59, 999, NY);
    expect(end.getTime() - start.getTime()).toBe(23 * 3_600_000 - 1);
  });

  it("handles the day the clocks go back", () => {
    // 1 November 2026 is 25 hours long in New York.
    const start = zonedWallClockToUtc(2026, 11, 1, 0, 0, 0, 0, NY);
    const end = zonedWallClockToUtc(2026, 11, 1, 23, 59, 59, 999, NY);
    expect(end.getTime() - start.getTime()).toBe(25 * 3_600_000 - 1);
  });

  it("is an exact inverse for UTC", () => {
    expect(
      zonedWallClockToUtc(2026, 10, 20, 13, 45, 30, 125, "UTC").toISOString(),
    ).toBe("2026-10-20T13:45:30.125Z");
  });
});

describe("zonedDayParts", () => {
  it("reports the day the instant falls on in the zone", () => {
    // 03:00 UTC on the 21st is still the evening of the 20th in New York.
    expect(zonedDayParts(new Date("2026-10-21T03:00:00Z"), NY)).toEqual({
      year: 2026,
      month: 10,
      day: 20,
    });
  });

  it("round-trips with zonedWallClockToUtc", () => {
    const instant = zonedWallClockToUtc(2026, 10, 20, 23, 59, 59, 999, NY);
    expect(zonedDayParts(instant, NY)).toEqual({
      year: 2026,
      month: 10,
      day: 20,
    });
  });
});

describe("the bug this replaced", () => {
  it("the old arithmetic excluded the chosen end day", () => {
    // Exactly what the previous implementation did, pinned here so the
    // regression is legible rather than just asserted against.
    const old = new Date("2026-10-20");
    const oldEnd = new Date(old);
    oldEnd.setHours(23, 59, 59, 999);

    const bookingTakenOn20th = zonedWallClockToUtc(
      2026, 10, 20, 22, 30, 0, 0, NY,
    );

    // In any zone behind UTC the old end landed before the booking.
    const serverIsBehindUtc = new Date().getTimezoneOffset() > 0;
    if (serverIsBehindUtc) {
      expect(oldEnd.getTime()).toBeLessThan(bookingTakenOn20th.getTime());
    }

    // The replacement includes it regardless of where the server runs.
    const newEnd = zonedWallClockToUtc(2026, 10, 20, 23, 59, 59, 999, NY);
    expect(newEnd.getTime()).toBeGreaterThan(bookingTakenOn20th.getTime());
  });
});
