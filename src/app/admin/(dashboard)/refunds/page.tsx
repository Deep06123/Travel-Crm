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
import { Badge, RefundStatusBadge } from "@/components/ui/status-badge";
import { RefundKind, RefundStatus } from "@/generated/prisma/enums";
import { RefundDecision } from "@/features/finance/refund-decision";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/financial/money";
import { formatDate } from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { listRefunds } from "@/server/services/refund-service";

export const metadata: Metadata = { title: "Refunds & voids · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export default async function RefundsPage({
  searchParams,
}: PageProps<"/admin/refunds">) {
  await requirePermission(PERMISSIONS.REFUND_VIEW);
  const [canApprove, canProcess] = await Promise.all([
    currentUserCan(PERMISSIONS.REFUND_APPROVE),
    currentUserCan(PERMISSIONS.REFUND_PROCESS),
  ]);

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const rawStatus = pick("status");
  const rawKind = pick("kind");

  const filters = {
    q: pick("q"),
    status:
      rawStatus && rawStatus in RefundStatus
        ? (rawStatus as RefundStatus)
        : undefined,
    kind: rawKind && rawKind in RefundKind ? (rawKind as RefundKind) : undefined,
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const result = await listRefunds(filters, pagination);

  const awaitingDecision = result.rows.filter(
    (row) => row.status === RefundStatus.PENDING,
  ).length;

  const buildHref = (page: number): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value !== "" && key !== "page") {
        query.set(key, value);
      }
    }
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/admin/refunds?${search}` : "/admin/refunds";
  };

  return (
    <>
      <PageHeader
        title="Refunds & voids"
        description={`${result.total.toLocaleString()} record${result.total === 1 ? "" : "s"}${awaitingDecision > 0 ? ` · ${awaitingDecision} awaiting a decision on this page` : ""}`}
      />

      <Card className="mb-4">
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          No refund provider is integrated. A completed refund here records that
          an operator carried it out elsewhere — the CRM has not moved any money
          and claims no provider reference. A refund also cannot be approved by
          the person who requested it.
        </p>
      </Card>

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
              placeholder="Reference, reason, booking number or customer"
            />
          </div>

          <div className="w-44">
            <label htmlFor="status" className="mb-1.5 block text-sm font-medium text-ink">
              Status
            </label>
            <Select id="status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">All</option>
              {Object.values(RefundStatus).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-36">
            <label htmlFor="kind" className="mb-1.5 block text-sm font-medium text-ink">
              Kind
            </label>
            <Select id="kind" name="kind" defaultValue={filters.kind ?? ""}>
              <option value="">All</option>
              <option value={RefundKind.REFUND}>Refund</option>
              <option value={RefundKind.VOID}>Void</option>
            </Select>
          </div>

          <Button type="submit">
            <Search />
            Search
          </Button>

          {Object.values(filters).some(Boolean) ? (
            <Link href="/admin/refunds" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </form>

        <TableShell>
          <Thead>
            <Tr>
              <Th>Reference</Th>
              <Th>Booking</Th>
              <Th>Kind</Th>
              <Th align="right">Requested</Th>
              <Th align="right">Approved</Th>
              <Th>Status</Th>
              <Th>Reason</Th>
              <Th>Requested by</Th>
              <Th>Action</Th>
            </Tr>
          </Thead>

          <Tbody>
            {result.rows.length === 0 ? (
              <EmptyState
                colSpan={9}
                title="No refunds or voids"
                description="These are raised from a booking's detail page."
              />
            ) : (
              result.rows.map((refund) => (
                <Tr key={refund.id}>
                  <Td className="font-medium">{refund.reference}</Td>
                  <Td>
                    <Link
                      href={`/admin/bookings/${refund.booking.id}`}
                      className="text-navy-500 hover:underline"
                    >
                      {refund.booking.bookingNumber}
                    </Link>
                    <div className="text-xs text-ink-muted">
                      {refund.booking.customer.firstName}{" "}
                      {refund.booking.customer.lastName}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={refund.kind === RefundKind.VOID ? "warning" : "neutral"}>
                      {humanise(refund.kind)}
                    </Badge>
                  </Td>
                  <Td align="right" numeric>
                    {formatMoney(refund.requestedAmountMinor, refund.currency)}
                  </Td>
                  <Td align="right" numeric>
                    {refund.approvedAmountMinor === null
                      ? "—"
                      : formatMoney(refund.approvedAmountMinor, refund.currency)}
                  </Td>
                  <Td>
                    <RefundStatusBadge status={refund.status} />
                    {refund.status === RefundStatus.COMPLETED ? (
                      <div className="mt-0.5 text-xs text-ink-subtle">
                        {refund.providerRefundId
                          ? `Provider ref ${refund.providerRefundId}`
                          : "Manually executed"}
                      </div>
                    ) : null}
                  </Td>
                  <Td className="max-w-56 text-ink-muted">
                    <span className="line-clamp-2">{refund.reason}</span>
                    {refund.decisionNote ? (
                      <span className="mt-0.5 block text-xs text-ink-subtle line-clamp-2">
                        {refund.decisionNote}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {refund.requestedBy?.name ?? "—"}
                    <div className="text-xs text-ink-subtle">
                      {formatDate(refund.requestedAt)}
                    </div>
                    {refund.approvedBy ? (
                      <div className="text-xs text-ink-subtle">
                        by {refund.approvedBy.name}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <RefundDecision
                      refundId={refund.id}
                      status={refund.status}
                      currency={refund.currency}
                      requestedAmountMinor={refund.requestedAmountMinor}
                      canApprove={canApprove}
                      canProcess={canProcess}
                    />
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
