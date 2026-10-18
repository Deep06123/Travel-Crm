import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/admin-shell";
import {
  MoneyTotals,
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
import { Badge } from "@/components/ui/status-badge";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/financial/money";
import { formatDate } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import { getSupplierPerformance } from "@/server/services/report-service";

export const metadata: Metadata = { title: "Supplier performance · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export default async function SupplierPerformancePage({
  searchParams,
}: PageProps<"/admin/reports/suppliers">) {
  await requirePermission(PERMISSIONS.REPORT_PERFORMANCE);
  const canViewMoney = await currentUserCan(PERMISSIONS.PAYMENT_VIEW);

  const params = await searchParams;
  const range = parseReportRange(params);
  const rows = await getSupplierPerformance(range);

  // Suppliers with no activity in the window add noise rather than signal.
  const active = rows.filter((row) => row.bookings > 0);

  return (
    <>
      <PageHeader
        title="Supplier performance"
        description={`${formatDate(range.from)} – ${formatDate(range.to)} · ${active.length} supplier${active.length === 1 ? "" : "s"} with activity`}
      />

      <ReportRangeForm
        from={range.from}
        to={range.to}
        action="/admin/reports/suppliers"
      />

      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <TableShell>
          <Thead>
            <Tr>
              <Th>Supplier</Th>
              <Th>Type</Th>
              <Th align="right">Bookings</Th>
              <Th align="right">Cancelled</Th>
              {canViewMoney ? <Th align="right">Booking value</Th> : null}
              {canViewMoney ? <Th align="right">Supplier cost</Th> : null}
              {canViewMoney ? <Th align="right">Gross MCO</Th> : null}
              {canViewMoney ? <Th align="right">Net MCO</Th> : null}
            </Tr>
          </Thead>
          <Tbody>
            {active.length === 0 ? (
              <EmptyState
                colSpan={canViewMoney ? 8 : 4}
                title="No supplier activity in this period"
                description="Try widening the date range."
              />
            ) : (
              active.map((row) => (
                <Tr key={row.id}>
                  <Td className="font-medium">{row.name}</Td>
                  <Td>
                    <Badge tone="neutral">{humanise(row.type)}</Badge>
                  </Td>
                  <Td align="right" numeric>{row.bookings}</Td>
                  <Td align="right" numeric>
                    {row.cancelled > 0 ? (
                      <span className="text-status-danger">{row.cancelled}</span>
                    ) : (
                      row.cancelled
                    )}
                  </Td>
                  {canViewMoney ? (
                    <>
                      <Td align="right">
                        <MoneyTotals totals={row.bookingValue} formatter={formatMoney} />
                      </Td>
                      <Td align="right">
                        <MoneyTotals totals={row.supplierCost} formatter={formatMoney} />
                      </Td>
                      <Td align="right">
                        <MoneyTotals totals={row.grossMco} formatter={formatMoney} />
                      </Td>
                      <Td align="right">
                        <MoneyTotals totals={row.netMco} formatter={formatMoney} />
                      </Td>
                    </>
                  ) : null}
                </Tr>
              ))
            )}
          </Tbody>
        </TableShell>
      </div>
    </>
  );
}
