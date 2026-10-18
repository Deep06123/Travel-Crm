import type { Metadata } from "next";

import { BookingTrendChart, StatusDistributionChart } from "@/components/dashboard/booking-trend-chart";
import { PageHeader } from "@/components/layout/admin-shell";
import {
  ReportRangeForm,
  parseReportRange,
} from "@/components/reports/report-range-form";
import {
  EmptyState,
  TableShell,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/tables/data-table";
import { Card, Panel } from "@/components/ui/panel";
import { requirePermission } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import { getBookingReport } from "@/server/services/report-service";

export const metadata: Metadata = { title: "Booking report · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** A grouped breakdown table with a share-of-total column. */
function Breakdown({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { label: string; count: number }[];
  total: number;
}) {
  const sorted = [...rows].sort((a, b) => b.count - a.count);

  return (
    <Panel title={title} collapsible={false}>
      <TableShell>
        <Thead>
          <Tr>
            <Th>{title}</Th>
            <Th align="right">Bookings</Th>
            <Th align="right">Share</Th>
          </Tr>
        </Thead>
        <Tbody>
          {sorted.length === 0 ? (
            <EmptyState colSpan={3} title="No bookings in this period" />
          ) : (
            sorted.map((row) => (
              <Tr key={row.label}>
                <Td>{row.label}</Td>
                <Td align="right" numeric>
                  {row.count.toLocaleString()}
                </Td>
                <Td align="right" numeric className="text-ink-muted">
                  {total === 0 ? "—" : `${((row.count / total) * 100).toFixed(1)}%`}
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </TableShell>
    </Panel>
  );
}

export default async function BookingReportPage({
  searchParams,
}: PageProps<"/admin/reports/bookings">) {
  await requirePermission(PERMISSIONS.REPORT_BOOKINGS);

  const params = await searchParams;
  const range = parseReportRange(params);
  const report = await getBookingReport(range);

  return (
    <>
      <PageHeader
        title="Booking report"
        description={`${formatDate(range.from)} – ${formatDate(range.to)}`}
      />

      <ReportRangeForm
        from={range.from}
        to={range.to}
        action="/admin/reports/bookings"
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
            Bookings in period
          </p>
          <p className="tabular mt-1 text-3xl font-semibold text-navy-500">
            {report.totalBookings.toLocaleString()}
          </p>
        </Card>

        {report.byProduct.map((row) => (
          <Card key={row.product}>
            <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
              {humanise(row.product)}
            </p>
            <p className="tabular mt-1 text-3xl font-semibold text-navy-500">
              {row.count.toLocaleString()}
            </p>
          </Card>
        ))}
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Booking trend" collapsible={false} className="lg:col-span-2">
          <BookingTrendChart
            data={report.trend.map((row) => ({
              date: row.date,
              bookings: row.count,
            }))}
          />
        </Panel>

        <Panel title="Status distribution" collapsible={false}>
          <StatusDistributionChart data={report.byStatus} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown
          title="Booking type"
          rows={report.byType}
          total={report.totalBookings}
        />
        <Breakdown
          title="Agent"
          rows={report.byAgent.map((row) => ({ label: row.name, count: row.count }))}
          total={report.totalBookings}
        />
        <Breakdown
          title="Supplier"
          rows={report.bySupplier.map((row) => ({ label: row.name, count: row.count }))}
          total={report.totalBookings}
        />
        <Breakdown
          title="Status"
          rows={report.byStatus.map((row) => ({
            label: humanise(row.status),
            count: row.count,
          }))}
          total={report.totalBookings}
        />
      </div>
    </>
  );
}
