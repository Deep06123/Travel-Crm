import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

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
import { Card, Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/status-badge";
import { TfnForm } from "@/features/admin/reference-forms";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/financial/money";
import { formatDate } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getTfnPerformance,
  listTfns,
} from "@/server/services/reference-data-service";

export const metadata: Metadata = { title: "TFN management · Travel CRM" };

export default async function TfnPage() {
  await requirePermission(PERMISSIONS.TFN_VIEW);
  const canManage = await currentUserCan(PERMISSIONS.TFN_MANAGE);

  // Last 30 days, matching the dashboard's default window.
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86_400_000);

  const [tfns, performance] = await Promise.all([
    listTfns(),
    getTfnPerformance(from, to),
  ]);

  const performanceById = new Map(performance.map((row) => [row.id, row]));

  return (
    <>
      <PageHeader
        title="TFN management"
        description={`${tfns.length} number${tfns.length === 1 ? "" : "s"} · performance over the last 30 days`}
      />

      <Card className="mb-4">
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          Toll-free numbers determine where customer calls land. Every change
          here is written to the audit log, and only roles holding
          <code className="mx-1 rounded bg-surface-sunken px-1">tfn.manage</code>
          can make one.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
            <TableShell>
              <Thead>
                <Tr>
                  <Th>Label</Th>
                  <Th>Number</Th>
                  <Th>Category</Th>
                  <Th align="right">Bookings (30d)</Th>
                  <Th align="right">Value (30d)</Th>
                  <Th align="right">All time</Th>
                  <Th>Status</Th>
                  <Th>Added</Th>
                </Tr>
              </Thead>
              <Tbody>
                {tfns.length === 0 ? (
                  <EmptyState
                    colSpan={8}
                    title="No numbers configured"
                    description="Add a toll-free number to attribute bookings to it."
                  />
                ) : (
                  tfns.map((tfn) => {
                    const stats = performanceById.get(tfn.id);

                    return (
                      <Tr key={tfn.id}>
                        <Td className="font-medium">{tfn.label}</Td>
                        <Td className="font-mono text-ink-muted">{tfn.number}</Td>
                        <Td className="text-ink-muted">{tfn.category ?? "—"}</Td>
                        <Td align="right" numeric>
                          {stats?.bookings ?? 0}
                        </Td>
                        <Td align="right" numeric>
                          {stats && stats.value.length > 0
                            ? stats.value
                                .map((row) =>
                                  formatMoney(row.amountMinor, row.currency),
                                )
                                .join(" · ")
                            : formatMoney(0, "USD")}
                        </Td>
                        <Td align="right" numeric>
                          {tfn._count.bookings}
                        </Td>
                        <Td>
                          <Badge tone={tfn.isActive ? "success" : "neutral"}>
                            {tfn.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </Td>
                        <Td className="whitespace-nowrap text-ink-muted">
                          {formatDate(tfn.createdAt)}
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </Tbody>
            </TableShell>
          </div>
        </div>

        {canManage ? (
          <div>
            <Panel title="Add number" collapsible={false}>
              <TfnForm />
            </Panel>
          </div>
        ) : null}
      </div>
    </>
  );
}
