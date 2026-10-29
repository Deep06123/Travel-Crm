import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  getBusinessTimeZone,
  toDateInputValue,
  zonedDayParts,
  zonedWallClockToUtc,
} from "@/lib/format";

/**
 * Date-range filter shared by every report.
 *
 * A plain GET form, so the chosen window lives in the URL and a report view can
 * be bookmarked or shared.
 */
export function ReportRangeForm({
  from,
  to,
  action,
}: {
  from: Date;
  to: Date;
  action: string;
}) {
  // The business timezone, not `toISOString`. The end of the chosen day in New
  // York is the small hours of the next day in UTC, so an ISO slice would echo
  // a date one later than the operator picked.
  const toInput = toDateInputValue;

  return (
    <form
      method="get"
      action={action}
      className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-4 shadow-sm"
    >
      <div>
        <label htmlFor="from" className="mb-1.5 block text-sm font-medium text-ink">
          From
        </label>
        <Input id="from" name="from" type="date" defaultValue={toInput(from)} />
      </div>
      <div>
        <label htmlFor="to" className="mb-1.5 block text-sm font-medium text-ink">
          To
        </label>
        <Input id="to" name="to" type="date" defaultValue={toInput(to)} />
      </div>
      <Button type="submit">
        <Search />
        Apply
      </Button>
    </form>
  );
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Turns a `YYYY-MM-DD` query value into the instant that day begins or ends.
 *
 * The day is read as a calendar day **in the business timezone**, which is the
 * only reading that matches what the operator meant. An earlier version did
 * `new Date("2026-10-20")` — midnight UTC — and then bounded the end of the day
 * with `setHours(23, 59, 59)`, which sets the *server's* local hours. Mixing
 * the two silently dropped the whole of the chosen end day in any timezone
 * behind UTC: a booking taken on the 20th did not appear in a range ending on
 * the 20th, and the range heading displayed the day before the one asked for.
 */
function parseDay(
  value: unknown,
  timeZone: string,
  edge: "start" | "end",
): Date | null {
  if (typeof value !== "string") return null;

  const match = DAY_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // `Date.UTC` rolls 31 February forward into March rather than rejecting it,
  // so a round-trip is what catches a day that does not exist.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }

  return edge === "end"
    ? zonedWallClockToUtc(year, month, day, 23, 59, 59, 999, timeZone)
    : zonedWallClockToUtc(year, month, day, 0, 0, 0, 0, timeZone);
}

/** Parses the `from`/`to` query values, falling back when absent or malformed. */
export function parseReportRange(params: Record<string, unknown>): {
  from: Date;
  to: Date;
} {
  const timeZone = getBusinessTimeZone();
  const today = zonedDayParts(new Date(), timeZone);

  const defaultTo = zonedWallClockToUtc(
    today.year,
    today.month,
    today.day,
    23,
    59,
    59,
    999,
    timeZone,
  );

  // Thirty days ending today, inclusive. Stepping back from the start of today
  // and re-reading the calendar day keeps the window a whole number of days
  // across a daylight-saving change, where 29 × 24h is not 29 days.
  const startOfToday = zonedWallClockToUtc(
    today.year,
    today.month,
    today.day,
    0,
    0,
    0,
    0,
    timeZone,
  );
  const earlier = zonedDayParts(
    new Date(startOfToday.getTime() - 29 * 86_400_000),
    timeZone,
  );
  const defaultFrom = zonedWallClockToUtc(
    earlier.year,
    earlier.month,
    earlier.day,
    0,
    0,
    0,
    0,
    timeZone,
  );

  let fromDay = parseDay(params["from"], timeZone, "start");
  let toDay = parseDay(params["to"], timeZone, "end");

  // A backwards range would report nothing at all, which reads as "no
  // activity" rather than "you have the dates the wrong way round". Both edges
  // are re-derived from the opposite day: exchanging the instants themselves
  // would pair an end-of-day with a start-of-day, leaving a one-minute window.
  if (fromDay !== null && toDay !== null && fromDay > toDay) {
    fromDay = parseDay(params["to"], timeZone, "start");
    toDay = parseDay(params["from"], timeZone, "end");
  }

  return { from: fromDay ?? defaultFrom, to: toDay ?? defaultTo };
}

/** Renders per-currency totals without ever adding currencies together. */
export function MoneyTotals({
  totals,
  fallbackCurrency = "USD",
  formatter,
}: {
  totals: { currency: string; amountMinor: number }[];
  fallbackCurrency?: string;
  formatter: (amountMinor: number, currency: string) => string;
}) {
  if (totals.length === 0) {
    return <span className="tabular">{formatter(0, fallbackCurrency)}</span>;
  }

  return (
    <span className="tabular">
      {totals.map((total, index) => (
        <span key={total.currency}>
          {index > 0 ? <span className="text-ink-subtle"> · </span> : null}
          {formatter(total.amountMinor, total.currency)}
        </span>
      ))}
    </span>
  );
}
