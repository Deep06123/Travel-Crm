import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

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
  const toInput = (date: Date) => date.toISOString().slice(0, 10);

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

/** Parses a `YYYY-MM-DD` query value, falling back when absent or malformed. */
export function parseReportRange(params: Record<string, unknown>): {
  from: Date;
  to: Date;
} {
  const defaultTo = new Date();
  const defaultFrom = new Date(defaultTo.getTime() - 29 * 86_400_000);

  const parse = (value: unknown, fallback: Date): Date => {
    if (typeof value !== "string" || value === "") return fallback;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  };

  const from = parse(params["from"], defaultFrom);
  const to = parse(params["to"], defaultTo);

  // Include the whole of the chosen end day.
  const rangeEnd = new Date(to);
  rangeEnd.setHours(23, 59, 59, 999);

  return { from, to: rangeEnd };
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
