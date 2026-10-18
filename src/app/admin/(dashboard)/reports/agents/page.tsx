import type { Metadata } from "next";
import { Info } from "lucide-react";

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
import { Card } from "@/components/ui/panel";
import { Badge } from "@/components/ui/status-badge";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/financial/money";
import { formatDate } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import { getAgentPerformance } from "@/server/services/report-service";

export const metadata: Metadata = { title: "Agent performance · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export default async function AgentPerformancePage({
  searchParams,
}: PageProps<"/admin/reports/agents">) {
  await requirePermission(PERMISSIONS.REPORT_PERFORMANCE);
  const canViewMoney = await currentUserCan(PERMISSIONS.PAYMENT_VIEW);

  const params = await searchParams;
  const range = parseReportRange(params);
  const rows = await getAgentPerformance(range);

  return (
    <>
      <PageHeader
        title="Agent performance"
        description={`${formatDate(range.from)} – ${formatDate(range.to)}`}
      />

      <ReportRangeForm from={range.from} to={range.to} action="/admin/reports/agents" />

      <Card className="mb-4">
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Counts and value only. There is deliberately no score and no ranking —
          these measures have not been validated as a basis for comparing people,
          and the row order is alphabetical rather than by any metric.
        </p>
      </Card>

      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <TableShell>
          <Thead>
            <Tr>
              <Th>Agent</Th>
              <Th>Role</Th>
              <Th align="right">Created</Th>
              <Th align="right">Assigned</Th>
              <Th align="right">Ticketed</Th>
              <Th align="right">Cancelled</Th>
              <Th align="right">Follow-ups done</Th>
              <Th align="right">Overdue</Th>
              {canViewMoney ? <Th align="right">Booking value</Th> : null}
            </Tr>
          </Thead>
          <Tbody>
            {rows.length === 0 ? (
              <EmptyState colSpan={canViewMoney ? 9 : 8} title="No active agents" />
            ) : (
              rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="font-medium">{row.name}</Td>
                  <Td>
                    <Badge tone="info">{humanise(row.role)}</Badge>
                  </Td>
                  <Td align="right" numeric>{row.created}</Td>
                  <Td align="right" numeric>{row.assigned}</Td>
                  <Td align="right" numeric>{row.ticketed}</Td>
                  <Td align="right" numeric>{row.cancelled}</Td>
                  <Td align="right" numeric>{row.completedFollowUps}</Td>
                  <Td align="right" numeric>
                    {row.overdueFollowUps > 0 ? (
                      <span className="font-medium text-status-danger">
                        {row.overdueFollowUps}
                      </span>
                    ) : (
                      row.overdueFollowUps
                    )}
                  </Td>
                  {canViewMoney ? (
                    <Td align="right">
                      <MoneyTotals totals={row.bookingValue} formatter={formatMoney} />
                    </Td>
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
