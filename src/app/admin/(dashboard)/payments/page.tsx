import type { Metadata } from "next";
import Link from "next/link";
import { Info, Search } from "lucide-react";

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
import { PaginationControls } from "@/components/tables/pagination-controls";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Card } from "@/components/ui/panel";
import { Badge, PaymentStatusBadge } from "@/components/ui/status-badge";
import {
  PaymentCaptureMode,
  PaymentMethod,
  PaymentStatus,
  ReconciliationStatus,
} from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/financial/money";
import { formatDateTime } from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { listPayments, summarisePayments } from "@/server/services/payment-service";

export const metadata: Metadata = { title: "Payments · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const RECONCILIATION_TONES = {
  [ReconciliationStatus.UNRECONCILED]: "neutral",
  [ReconciliationStatus.MATCHED]: "success",
  [ReconciliationStatus.DISPUTED]: "danger",
  [ReconciliationStatus.WRITTEN_OFF]: "warning",
} as const;

export default async function PaymentsPage({
  searchParams,
}: PageProps<"/admin/payments">) {
  await requirePermission(PERMISSIONS.PAYMENT_VIEW);

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const rawStatus = pick("status");
  const rawMethod = pick("method");
  const rawReconciliation = pick("reconciliationStatus");

  const filters = {
    q: pick("q"),
    status:
      rawStatus && rawStatus in PaymentStatus
        ? (rawStatus as PaymentStatus)
        : undefined,
    method:
      rawMethod && rawMethod in PaymentMethod
        ? (rawMethod as PaymentMethod)
        : undefined,
    reconciliationStatus:
      rawReconciliation && rawReconciliation in ReconciliationStatus
        ? (rawReconciliation as ReconciliationStatus)
        : undefined,
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const [result, summary] = await Promise.all([
    listPayments(filters, pagination),
    summarisePayments(filters),
  ]);

  // Captured is the only status that means money arrived, so it is the only
  // one summarised as "collected".
  const collected = summary.filter((row) => row.status === PaymentStatus.CAPTURED);
  const pending = summary.filter((row) => row.status === PaymentStatus.PENDING);

  const buildHref = (page: number): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value !== "" && key !== "page") {
        query.set(key, value);
      }
    }
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/admin/payments?${search}` : "/admin/payments";
  };

  return (
    <>
      <PageHeader
        title="Payments"
        description={`${result.total.toLocaleString()} payment${result.total === 1 ? "" : "s"}`}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
            Collected
          </p>
          <p className="tabular mt-1 text-2xl font-semibold text-status-success">
            {collected.length === 0
              ? formatMoney(0, "USD")
              : collected
                  .map((row) => formatMoney(row.amountMinor, row.currency))
                  .join(" · ")}
          </p>
          <p className="mt-0.5 text-xs text-ink-subtle">Captured payments only</p>
        </Card>

        <Card>
          <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
            Pending
          </p>
          <p className="tabular mt-1 text-2xl font-semibold text-status-warning">
            {pending.length === 0
              ? formatMoney(0, "USD")
              : pending
                  .map((row) => formatMoney(row.amountMinor, row.currency))
                  .join(" · ")}
          </p>
          <p className="mt-0.5 text-xs text-ink-subtle">Not yet collected</p>
        </Card>

        <Card>
          <p className="flex items-start gap-2 text-xs text-ink-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            No payment provider is integrated. Every payment here was entered by
            an operator and is labelled as such — none has been confirmed by a
            processor.
          </p>
        </Card>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-ink">
              Search
            </label>
            <Input
              id="q"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Reference, transaction id, last 4, booking or customer"
            />
          </div>

          <div className="w-44">
            <label htmlFor="status" className="mb-1.5 block text-sm font-medium text-ink">
              Status
            </label>
            <Select id="status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">All</option>
              {Object.values(PaymentStatus).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-44">
            <label htmlFor="method" className="mb-1.5 block text-sm font-medium text-ink">
              Method
            </label>
            <Select id="method" name="method" defaultValue={filters.method ?? ""}>
              <option value="">All</option>
              {Object.values(PaymentMethod).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-44">
            <label
              htmlFor="reconciliationStatus"
              className="mb-1.5 block text-sm font-medium text-ink"
            >
              Reconciliation
            </label>
            <Select
              id="reconciliationStatus"
              name="reconciliationStatus"
              defaultValue={filters.reconciliationStatus ?? ""}
            >
              <option value="">All</option>
              {Object.values(ReconciliationStatus).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          <Button type="submit">
            <Search />
            Search
          </Button>

          {Object.values(filters).some(Boolean) ? (
            <Link href="/admin/payments" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </form>

        <TableShell>
          <Thead>
            <Tr>
              <Th>Reference</Th>
              <Th>Booking</Th>
              <Th>Customer</Th>
              <Th align="right">Amount</Th>
              <Th>Method</Th>
              <Th>Status</Th>
              <Th>Source</Th>
              <Th>Reconciliation</Th>
              <Th>Recorded</Th>
            </Tr>
          </Thead>

          <Tbody>
            {result.rows.length === 0 ? (
              <EmptyState
                colSpan={9}
                title="No payments"
                description="Payments are recorded against a booking from its detail page."
              />
            ) : (
              result.rows.map((payment) => (
                <Tr key={payment.id}>
                  <Td className="font-medium">{payment.reference}</Td>
                  <Td>
                    <Link
                      href={`/admin/bookings/${payment.booking.id}`}
                      className="text-navy-500 hover:underline"
                    >
                      {payment.booking.bookingNumber}
                    </Link>
                  </Td>
                  <Td className="text-ink-muted">
                    {payment.customer
                      ? `${payment.customer.firstName} ${payment.customer.lastName}`
                      : "—"}
                  </Td>
                  <Td align="right" numeric>
                    {formatMoney(payment.amountMinor, payment.currency)}
                  </Td>
                  <Td className="text-ink-muted">
                    {humanise(payment.method)}
                    {payment.cardLast4 ? (
                      <div className="text-xs text-ink-subtle">
                        {payment.cardBrand ?? "Card"} ····{payment.cardLast4}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <PaymentStatusBadge status={payment.status} />
                    {payment.failureReason ? (
                      <div className="mt-0.5 text-xs text-status-danger">
                        {payment.failureReason}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    {/* The provenance distinction the plan requires: a typed
                        record is never shown as provider-verified. */}
                    <Badge
                      tone={
                        payment.captureMode === PaymentCaptureMode.PROVIDER_CONFIRMED
                          ? "success"
                          : "neutral"
                      }
                    >
                      {payment.captureMode === PaymentCaptureMode.PROVIDER_CONFIRMED
                        ? `Confirmed by ${payment.provider ?? "provider"}`
                        : "Manually recorded"}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={RECONCILIATION_TONES[payment.reconciliationStatus]}>
                      {humanise(payment.reconciliationStatus)}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {formatDateTime(payment.createdAt)}
                    <div className="text-xs text-ink-subtle">
                      {payment.recordedBy?.name ?? "—"}
                    </div>
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </TableShell>

        <PaginationControls
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          pageSize={result.pageSize}
          buildHref={buildHref}
        />
      </div>
    </>
  );
}
