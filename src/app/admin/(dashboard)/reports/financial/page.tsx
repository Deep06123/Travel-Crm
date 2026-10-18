import type { Metadata } from "next";
import { Info } from "lucide-react";

import { PageHeader } from "@/components/layout/admin-shell";
import {
  MoneyTotals,
  ReportRangeForm,
  parseReportRange,
} from "@/components/reports/report-range-form";
import {
  TableShell,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/tables/data-table";
import { Card, Panel } from "@/components/ui/panel";
import { requirePermission } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/financial/money";
import { formatDate } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getFinancialReport,
  type CurrencyTotal,
} from "@/server/services/report-service";

export const metadata: Metadata = { title: "Financial report · Travel CRM" };

/** One measure, with the definition that makes it unambiguous. */
function MeasureRow({
  label,
  definition,
  totals,
  tone,
}: {
  label: string;
  definition: string;
  totals: CurrencyTotal[];
  tone?: "success" | "danger" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "text-status-success"
      : tone === "danger"
        ? "text-status-danger"
        : tone === "warning"
          ? "text-status-warning"
          : "text-ink";

  return (
    <Tr>
      <Td>
        <span className="font-medium text-ink">{label}</span>
        <div className="max-w-96 text-xs text-ink-muted">{definition}</div>
      </Td>
      <Td align="right" className={`font-medium ${toneClass}`}>
        <MoneyTotals totals={totals} formatter={formatMoney} />
      </Td>
    </Tr>
  );
}

export default async function FinancialReportPage({
  searchParams,
}: PageProps<"/admin/reports/financial">) {
  await requirePermission(PERMISSIONS.REPORT_FINANCIAL);

  const params = await searchParams;
  const range = parseReportRange(params);
  const report = await getFinancialReport(range);

  return (
    <>
      <PageHeader
        title="Financial report"
        description={`${formatDate(range.from)} – ${formatDate(range.to)}`}
      />

      <ReportRangeForm
        from={range.from}
        to={range.to}
        action="/admin/reports/financial"
      />

      <Card className="mb-4">
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Each measure answers a different question and they routinely disagree,
          so they are reported separately rather than reconciled into one
          headline. Amounts are grouped by currency and never added across
          currencies. Cancelled bookings are excluded from value measures.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Booking value" collapsible={false}>
          <TableShell>
            <Thead>
              <Tr>
                <Th>Measure</Th>
                <Th align="right">Amount</Th>
              </Tr>
            </Thead>
            <Tbody>
              <MeasureRow
                label="Gross booking value"
                definition="What customers were contracted to pay. Independent of whether money moved."
                totals={report.grossBookingValue}
              />
              <MeasureRow
                label="Supplier cost"
                definition="What we owe suppliers for fulfilling these bookings."
                totals={report.supplierCost}
              />
              <MeasureRow
                label="Margin"
                definition="Gross booking value less supplier cost. May be negative."
                totals={report.margin}
              />
              <MeasureRow
                label="Gross MCO"
                definition="MCO value before deductions. Tracked apart from booking value."
                totals={report.grossMco}
              />
              <MeasureRow
                label="Net MCO"
                definition="MCO value after deductions."
                totals={report.netMco}
              />
            </Tbody>
          </TableShell>
        </Panel>

        <Panel title="Cash position" collapsible={false}>
          <TableShell>
            <Thead>
              <Tr>
                <Th>Measure</Th>
                <Th align="right">Amount</Th>
              </Tr>
            </Thead>
            <Tbody>
              <MeasureRow
                label="Payments collected"
                definition="Captured payments only. A pending payment or a saved payment link counts for nothing here."
                totals={report.paymentsCollected}
                tone="success"
              />
              <MeasureRow
                label="Payments pending"
                definition="Raised but not captured. Not collected, and not counted as such."
                totals={report.paymentsPending}
                tone="warning"
              />
              <MeasureRow
                label="Refunds issued"
                definition="Completed refunds only — money that has actually left the account."
                totals={report.refundsIssued}
                tone="danger"
              />
              <MeasureRow
                label="Refunds approved, not yet paid"
                definition="Approved or processing. A commitment, not a disbursement."
                totals={report.refundsApprovedNotPaid}
                tone="warning"
              />
              <MeasureRow
                label="Net collections"
                definition="Collected less refunded."
                totals={report.netCollections}
                tone="success"
              />
              <MeasureRow
                label="Outstanding balance"
                definition="Gross booking value less net collections. Positive means customers still owe."
                totals={report.outstandingBalance}
              />
            </Tbody>
          </TableShell>
        </Panel>

        <Panel title="Disputes" collapsible={false} className="lg:col-span-2">
          <TableShell>
            <Thead>
              <Tr>
                <Th>Measure</Th>
                <Th align="right">Amount</Th>
              </Tr>
            </Thead>
            <Tbody>
              <MeasureRow
                label="Chargebacks open"
                definition="Disputed and unresolved. Exposure, not yet a loss — the money is still with us."
                totals={report.chargebacksOpen}
                tone="warning"
              />
              <MeasureRow
                label="Chargebacks lost or accepted"
                definition="Resolved against us. This money is gone."
                totals={report.chargebacksLost}
                tone="danger"
              />
            </Tbody>
          </TableShell>
        </Panel>
      </div>
    </>
  );
}
