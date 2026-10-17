import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import {
  BookingTrendChart,
  StatusDistributionChart,
} from "@/components/dashboard/booking-trend-chart";
import { PageHeader } from "@/components/layout/admin-shell";
import {
  EmptyState,
  TableShell,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/tables/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Card, Panel } from "@/components/ui/panel";
import {
  BookingStatusBadge,
  TicketStatusBadge,
} from "@/components/ui/status-badge";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/financial/money";
import { formatDate, formatDateTime, formatRelativeDays } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getDashboardMetrics,
  type CurrencyTotal,
} from "@/server/services/dashboard-service";

export const metadata: Metadata = { title: "Dashboard · Travel CRM" };

/**
 * Renders a per-currency total.
 *
 * Multiple currencies are listed separately rather than added together, since
 * no exchange-rate policy is configured. A missing total reads as zero in the
 * default currency rather than as a blank.
 */
function MoneyTotals({
  totals,
  fallbackCurrency = "USD",
}: {
  totals: CurrencyTotal[];
  fallbackCurrency?: string;
}) {
  if (totals.length === 0) {
    return <span className="tabular">{formatMoney(0, fallbackCurrency)}</span>;
  }

  return (
    <span className="tabular">
      {totals.map((total, index) => (
        <span key={total.currency}>
          {index > 0 ? <span className="text-ink-subtle"> · </span> : null}
          {formatMoney(total.amountMinor, total.currency)}
        </span>
      ))}
    </span>
  );
}

function KpiCard({
  label,
  value,
  tone = "navy",
  href,
  note,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "navy" | "success" | "warning" | "danger" | "info";
  href?: string;
  note?: string;
}) {
  const toneClasses = {
    navy: "text-navy-500",
    success: "text-status-success",
    warning: "text-status-warning",
    danger: "text-status-danger",
    info: "text-status-info",
  } as const;

  const body = (
    <Card className={href ? "transition-colors hover:border-navy-300" : undefined}>
      <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
        {label}
      </p>
      <p className={`tabular mt-1 text-2xl font-semibold ${toneClasses[tone]}`}>
        {value}
      </p>
      {note ? <p className="mt-0.5 text-xs text-ink-subtle">{note}</p> : null}
    </Card>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}

/** Parses a `YYYY-MM-DD` query value, falling back when absent or malformed. */
function parseDate(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" || value === "") return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export default async function DashboardPage({
  searchParams,
}: PageProps<"/admin">) {
  const user = await requirePermission(PERMISSIONS.BOOKING_VIEW);
  const [canViewMoney, canViewPerformance] = await Promise.all([
    currentUserCan(PERMISSIONS.PAYMENT_VIEW),
    currentUserCan(PERMISSIONS.REPORT_PERFORMANCE),
  ]);

  const params = await searchParams;

  // Default window: the last 30 days, inclusive of today.
  const defaultTo = new Date();
  const defaultFrom = new Date(defaultTo.getTime() - 29 * 86_400_000);

  const from = parseDate(params["from"], defaultFrom);
  const to = parseDate(params["to"], defaultTo);
  // Extend to the end of the chosen day so bookings taken that afternoon count.
  const rangeEnd = new Date(to);
  rangeEnd.setHours(23, 59, 59, 999);

  const metrics = await getDashboardMetrics({ from, to: rangeEnd });

  const toInput = (date: Date) => date.toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${formatDate(from)} – ${formatDate(to)} · signed in as ${user.name}`}
      />

      <form
        method="get"
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

      {/* Volume */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Bookings"
          value={metrics.counts.newBookings.toLocaleString()}
          note={`${metrics.counts.totalBookings.toLocaleString()} all time`}
          href="/admin/bookings"
        />
        <KpiCard
          label="Pending"
          value={metrics.counts.pending.toLocaleString()}
          tone="warning"
          href="/admin/bookings?status=PENDING"
        />
        <KpiCard
          label="Needs review"
          value={metrics.counts.needsReview.toLocaleString()}
          tone="warning"
          href="/admin/bookings?status=NEEDS_REVIEW"
        />
        <KpiCard
          label="Confirmed"
          value={metrics.counts.confirmed.toLocaleString()}
          tone="success"
          href="/admin/bookings?status=CONFIRMED"
        />
        <KpiCard
          label="Ticketed"
          value={metrics.counts.ticketed.toLocaleString()}
          tone="success"
          href="/admin/bookings?status=TICKETED"
        />
        <KpiCard
          label="Cancelled"
          value={metrics.counts.cancelled.toLocaleString()}
          tone="danger"
          href="/admin/bookings?status=CANCELLED"
        />
      </div>

      {/* Money. Each measure answers a different question, so they are shown
          side by side rather than reconciled into one headline number. */}
      {canViewMoney ? (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            label="Gross booking value"
            value={<MoneyTotals totals={metrics.financial.grossBookingValue} />}
            note="Charged to customers"
          />
          <KpiCard
            label="Payments collected"
            value={<MoneyTotals totals={metrics.financial.paymentsCollected} />}
            tone="success"
            note="Captured only"
          />
          <KpiCard
            label="Refunds issued"
            value={<MoneyTotals totals={metrics.financial.refundsIssued} />}
            tone="danger"
            note="Completed only"
          />
          <KpiCard
            label="Net collections"
            value={<MoneyTotals totals={metrics.financial.netCollections} />}
            tone="info"
            note="Collected − refunded"
          />
          <KpiCard
            label="Gross / net MCO"
            value={<MoneyTotals totals={metrics.financial.grossMco} />}
            note={`Net ${metrics.financial.netMco.map((total) => formatMoney(total.amountMinor, total.currency)).join(" · ") || "—"}`}
          />
        </div>
      ) : null}

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Booking trend" collapsible={false} className="lg:col-span-2">
          <BookingTrendChart data={metrics.trend} />
        </Panel>

        <Panel title="Status distribution" collapsible={false}>
          <StatusDistributionChart data={metrics.statusDistribution} />
        </Panel>
      </div>

      {/* Work queues */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pending ticketing"
          value={metrics.pendingTicketing.toLocaleString()}
          tone="warning"
          href="/admin/bookings?ticketStatus=PENDING"
          note="Confirmed or pending, not yet issued"
        />
        <KpiCard
          label="Overdue follow-ups"
          value={metrics.overdueFollowUps.length.toLocaleString()}
          tone="danger"
        />
        <KpiCard
          label="High priority open"
          value={metrics.highPriorityOpen.toLocaleString()}
          tone="danger"
          note="Module arrives in phase 5"
        />
        <KpiCard
          label="Refunds needing attention"
          value={metrics.refundsAwaitingAttention.toLocaleString()}
          tone="warning"
          note="Module arrives in phase 4"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {canViewPerformance ? (
          <Panel title="MCO supplier report" collapsible={false}>
            <TableShell>
              <Thead>
                <Tr>
                  <Th>Supplier</Th>
                  <Th align="right">Bookings</Th>
                  <Th align="right">Gross MCO</Th>
                  <Th align="right">Net MCO</Th>
                </Tr>
              </Thead>
              <Tbody>
                {metrics.supplierPerformance.length === 0 ? (
                  <EmptyState colSpan={4} title="No supplier activity in this period" />
                ) : (
                  metrics.supplierPerformance.map((supplier) => (
                    <Tr key={supplier.id}>
                      <Td>{supplier.name}</Td>
                      <Td align="right" numeric>
                        {supplier.bookings}
                      </Td>
                      <Td align="right">
                        <MoneyTotals totals={supplier.grossMco} />
                      </Td>
                      <Td align="right">
                        <MoneyTotals totals={supplier.netMco} />
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </TableShell>
          </Panel>
        ) : null}

        {canViewPerformance ? (
          <Panel
            title="Agent performance"
            description="Counts and value only. Agents are not ranked on unvalidated metrics."
            collapsible={false}
          >
            <TableShell>
              <Thead>
                <Tr>
                  <Th>Agent</Th>
                  <Th align="right">Bookings</Th>
                  <Th align="right">Ticketed</Th>
                  <Th align="right">Booking value</Th>
                </Tr>
              </Thead>
              <Tbody>
                {metrics.agentPerformance.length === 0 ? (
                  <EmptyState colSpan={4} title="No agent activity in this period" />
                ) : (
                  metrics.agentPerformance.map((agent) => (
                    <Tr key={agent.id}>
                      <Td>{agent.name}</Td>
                      <Td align="right" numeric>
                        {agent.bookings}
                      </Td>
                      <Td align="right" numeric>
                        {agent.ticketed}
                      </Td>
                      <Td align="right">
                        <MoneyTotals totals={agent.grossBookingValue} />
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </TableShell>
          </Panel>
        ) : null}

        <Panel title="Recent bookings" collapsible={false}>
          <TableShell>
            <Thead>
              <Tr>
                <Th>Booking</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Ticketing</Th>
                {canViewMoney ? <Th align="right">Total</Th> : null}
                <Th>Date</Th>
              </Tr>
            </Thead>
            <Tbody>
              {metrics.recentBookings.length === 0 ? (
                <EmptyState colSpan={canViewMoney ? 6 : 5} title="No bookings yet" />
              ) : (
                metrics.recentBookings.map((booking) => (
                  <Tr key={booking.id}>
                    <Td>
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className="font-medium text-navy-500 hover:underline"
                      >
                        {booking.bookingNumber}
                      </Link>
                    </Td>
                    <Td>{booking.customerName}</Td>
                    <Td>
                      <BookingStatusBadge status={booking.status} />
                    </Td>
                    <Td>
                      <TicketStatusBadge status={booking.ticketStatus} />
                    </Td>
                    {canViewMoney ? (
                      <Td align="right" numeric>
                        {formatMoney(booking.totalMinor, booking.currency)}
                      </Td>
                    ) : null}
                    <Td className="whitespace-nowrap text-ink-muted">
                      {formatDateTime(booking.bookedAt)}
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </TableShell>
        </Panel>

        <Panel title="Overdue follow-ups" collapsible={false}>
          <TableShell>
            <Thead>
              <Tr>
                <Th>Booking</Th>
                <Th>Reason</Th>
                <Th>Assigned</Th>
                <Th>Due</Th>
              </Tr>
            </Thead>
            <Tbody>
              {metrics.overdueFollowUps.length === 0 ? (
                <EmptyState colSpan={4} title="Nothing overdue" />
              ) : (
                metrics.overdueFollowUps.map((followUp) => (
                  <Tr key={followUp.id}>
                    <Td>
                      <Link
                        href={`/admin/bookings/${followUp.bookingId}`}
                        className="font-medium text-navy-500 hover:underline"
                      >
                        {followUp.bookingNumber}
                      </Link>
                    </Td>
                    <Td>{followUp.reason}</Td>
                    <Td className="text-ink-muted">{followUp.assigneeName ?? "—"}</Td>
                    <Td className="whitespace-nowrap font-medium text-status-danger">
                      {formatRelativeDays(followUp.dueAt)}
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </TableShell>
        </Panel>
      </div>
    </>
  );
}
