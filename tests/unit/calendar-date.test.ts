import { describe, expect, it } from "vitest";

import { formatCalendarDate, formatDate } from "@/lib/format";

/**
 * Calendar days versus instants.
 *
 * A date-only column arrives from its `<input type="date">` as "2027-11-09"
 * and is stored as midnight UTC. Rendering that in a business timezone west of
 * UTC lands on the previous evening and prints the wrong day — which is how a
 * sailing entered as the ninth of November came back as the eighth, on the
 * booking page, the confirmation email and the e-ticket.
 *
 * `BUSINESS_TIMEZONE` is not set under vitest, so `formatDate` falls back to
 * UTC here and the two agree. The cases that matter are therefore written
 * against `Intl` directly, which is where the shift actually happens, so they
 * fail if `formatCalendarDate` ever stops pinning the timezone.
 */

/** What `formatCalendarDate` must never do: read the day in a local zone. */
function inZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(date);
}

describe("formatCalendarDate", () => {
  it("keeps the day a date-only column was stored with", () => {
    const sailDate = new Date("2027-11-09T00:00:00Z");

    expect(formatCalendarDate(sailDate)).toBe("09 Nov 2027");
  });

  it("does not drift in a timezone behind UTC", () => {
    const sailDate = new Date("2027-11-09T00:00:00Z");

    // The bug, demonstrated: the same instant reads as the previous day in
    // the timezone this application is configured for.
    expect(inZone(sailDate, "America/New_York")).toBe("08 Nov 2027");

    // And the fix: the stored day survives regardless.
    expect(formatCalendarDate(sailDate)).toBe("09 Nov 2027");
  });

  it("does not drift in a timezone ahead of UTC either", () => {
    const dateOfBirth = new Date("1988-07-04T00:00:00Z");

    expect(inZone(dateOfBirth, "Pacific/Auckland")).toBe("04 Jul 1988");
    expect(formatCalendarDate(dateOfBirth)).toBe("04 Jul 1988");
  });

  it("holds across a month and a year boundary", () => {
    expect(formatCalendarDate(new Date("2027-01-01T00:00:00Z"))).toBe(
      "01 Jan 2027",
    );
    expect(formatCalendarDate(new Date("2027-03-01T00:00:00Z"))).toBe(
      "01 Mar 2027",
    );
  });

  it("reads the same as formatDate, so only the timezone differs", () => {
    // The wording must stay identical — this replaces `formatDate` at the
    // calendar-day call sites and should be invisible apart from the day.
    const value = new Date("2026-10-15T12:00:00Z");

    expect(formatCalendarDate(value)).toBe(formatDate(value));
  });

  it("renders nothing for a missing or unparseable value", () => {
    expect(formatCalendarDate(null)).toBe("—");
    expect(formatCalendarDate(undefined)).toBe("—");
    expect(formatCalendarDate("")).toBe("—");
    expect(formatCalendarDate("not a date")).toBe("—");
  });

  it("accepts the ISO string a date column round-trips as", () => {
    expect(formatCalendarDate("2027-11-09T00:00:00.000Z")).toBe("09 Nov 2027");
  });
});
