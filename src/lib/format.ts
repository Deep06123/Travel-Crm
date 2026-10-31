import { getEnv } from "@/lib/env";

/**
 * Display formatting.
 *
 * Dates render in the configured business timezone rather than the server's,
 * so a booking taken at 23:30 in New York does not appear on the following day
 * because the host happens to run UTC. Reports bucket on the same timezone.
 */

let cachedTimeZone: string | undefined;

function businessTimeZone(): string {
  if (cachedTimeZone) return cachedTimeZone;

  try {
    cachedTimeZone = getEnv().BUSINESS_TIMEZONE;
  } catch {
    // Client components have no access to server configuration.
    cachedTimeZone = "UTC";
  }

  return cachedTimeZone;
}

/** e.g. "15 Oct 2026". */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: businessTimeZone(),
  }).format(date);
}

/** e.g. "15 Oct 2026, 14:56". 24-hour, matching the reference CRM. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: businessTimeZone(),
  }).format(date);
}

/**
 * e.g. "15 Oct 2026", for a column that holds a calendar day rather than an
 * instant — a departure date, a sail date, a date of birth.
 *
 * Rendered in UTC, deliberately, and NOT in the business timezone. A date-only
 * field arrives from its `<input type="date">` as "2027-11-09" and is stored
 * as midnight UTC. Reading that back in America/New_York lands at 19:00 the
 * previous evening, so the booking displayed "08 Nov 2027" for a sailing the
 * operator had entered as the ninth — on the booking page, the confirmation
 * email and the e-ticket alike.
 *
 * The day someone typed is the day the customer travels. It is a label on a
 * calendar, not a moment in time, and no timezone is entitled to move it.
 *
 * `formatDate` remains correct for an actual instant — when a payment was
 * taken, when a document was uploaded — where the business timezone is
 * precisely what should be shown. The two differ only in that choice; the
 * rendered wording is identical.
 */
export function formatCalendarDate(
  value: Date | string | null | undefined,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** The configured business timezone, e.g. "America/New_York". */
export function getBusinessTimeZone(): string {
  return businessTimeZone();
}

/** How far `timeZone` is from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));

  const read = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };

  // `hour12: false` renders midnight as 24 rather than 0 in some engines.
  const wallClock = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second"),
  );

  // The parts carry no milliseconds, so compare against a whole second.
  return wallClock - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which a given wall-clock time occurs in a named timezone.
 *
 * The inverse of reading a `Date` in a timezone, and the thing you need to turn
 * "the 20th, in New York" into the pair of instants a database query can use.
 * `new Date("2026-10-20")` will not do it: that is parsed as midnight *UTC*,
 * which in New York is still the evening of the 19th.
 *
 * Two passes. The first converts using the offset in force at the naive
 * instant, which is right except near a daylight-saving transition, where the
 * correction can carry the result across the boundary and out of the offset it
 * was computed with. The second pass re-reads the offset at the corrected
 * instant and applies it to the original wall clock, which settles it.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const firstPass = naive - zoneOffsetMs(naive, timeZone);
  return new Date(naive - zoneOffsetMs(firstPass, timeZone));
}

/** The calendar day `instant` falls on in `timeZone`, as y/m/d numbers. */
export function zonedDayParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  // en-CA gives "2026-10-29", which splits without ambiguity.
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  })
    .format(instant)
    .split("-")
    .map(Number);

  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

/**
 * The instants bounding the calendar day a date-only value names, read in the
 * business timezone.
 *
 * A filter value arrives from an `<input type="date">` as "2026-10-20" and is
 * parsed to midnight UTC. The day the operator meant is the 20th *where the
 * business is*, so a window over instants has to be rebuilt in that zone —
 * adding 24 hours to midnight UTC ends the day four hours early in New York,
 * and a booking taken that evening falls outside its own day.
 */
export function businessDayBounds(dateOnly: Date): { start: Date; end: Date } {
  const timeZone = businessTimeZone();
  const year = dateOnly.getUTCFullYear();
  const month = dateOnly.getUTCMonth() + 1;
  const day = dateOnly.getUTCDate();

  return {
    start: zonedWallClockToUtc(year, month, day, 0, 0, 0, 0, timeZone),
    end: zonedWallClockToUtc(year, month, day, 23, 59, 59, 999, timeZone),
  };
}

/** Value for an `<input type="date">`, in the business timezone. */
export function toDateInputValue(
  value: Date | string | null | undefined,
): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";

  // en-CA gives ISO-ordered parts, which is exactly the input's format.
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: businessTimeZone(),
  }).format(date);
}

/**
 * Value for an `<input type="date">` holding a calendar date.
 *
 * The UTC counterpart of `toDateInputValue`, and for the reason set out above
 * `formatCalendarDate`: a sail date or a date of birth is stored as midnight
 * UTC, and rendering it in the business timezone lands on the previous
 * evening — so editing a sailing on the ninth would offer the eighth, and
 * saving without touching the field would silently move it a day earlier
 * every time.
 */
export function toCalendarInputValue(
  value: Date | string | null | undefined,
): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

/**
 * True when a due date has passed.
 *
 * Lives here rather than inline in a component because React's purity rule
 * forbids calling `Date.now()` during render — the result would change between
 * renders of the same component.
 */
export function isOverdue(value: Date | string | null | undefined): boolean {
  if (!value) return false;
  const date = typeof value === "string" ? new Date(value) : value;
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

/** "3 days overdue" / "in 2 days" / "today". */
export function formatRelativeDays(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);

  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}

/** Full name from its parts, skipping missing ones. */
export function fullName(
  parts: {
    firstName?: string | null;
    middleName?: string | null;
    lastName?: string | null;
  },
): string {
  return [parts.firstName, parts.middleName, parts.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}
