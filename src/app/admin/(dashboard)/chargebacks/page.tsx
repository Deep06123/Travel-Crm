import type { Metadata } from "next";
import Link from "next/link";
import { Info, Search, TriangleAlert } from "lucide-react";

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
import { Badge, ChargebackStatusBadge } from "@/components/ui/status-badge";
import { ChargebackStatus } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/financial/money";
import { formatDate, formatRelativeDays, isOverdue } from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { listChargebacks } from "@/server/services/chargeback-service";

export const metadata: Metadata = { title: "Chargebacks · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** A case is still contestable while it has not reached an outcome. */
const OPEN_STATUSES: readonly ChargebackStatus[] = [
  ChargebackStatus.RECEIVED,
  ChargebackStatus.EVIDENCE_REQUIRED,
  ChargebackStatus.EVIDENCE_SUBMITTED,
];

export default async function ChargebacksPage({
  searchParams,
}: PageProps<"/admin/chargebacks">) {
  await requirePermission(PERMISSIONS.CHARGEBACK_VIEW);

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const rawStatus = pick("status");

  const filters = {
    q: pick("q"),
    status:
      rawStatus && rawStatus in ChargebackStatus
        ? (rawStatus as ChargebackStatus)
        : undefined,
    overdueOnly: pick("overdueOnly") === "1",
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const result = await listChargebacks(filters, pagination);

  const overdueOnPage = result.rows.filter(
    (row) =>
      OPEN_STATUSES.includes(row.status) && row.respondBy && isOverdue(row.respondBy),
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
    return search ? `/admin/chargebacks?${search}` : "/admin/chargebacks";
  };

  return (
    <>
      <PageHeader
        title="Chargebacks"
        description={`${result.total.toLocaleString()} case${result.total === 1 ? "" : "s"}`}
      />

      {overdueOnPage > 0 ? (
        <p
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
        >
          <TriangleAlert className="size-4 shrink-0" />
          {overdueOnPage} case{overdueOnPage === 1 ? " has" : "s have"} passed the
          response deadline. A missed deadline forfeits the dispute.
        </p>
      ) : null}

      <Card className="mb-4">
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Cases are prepared and tracked here. No payment processor is
          integrated, so marking evidence submitted records internal progress —
          it does not file anything. A submission reference appears only when a
          real submission returns one.
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
              placeholder="Reference, reason code or booking number"
            />
          </div>

          <div className="w-52">
            <label htmlFor="status" className="mb-1.5 block text-sm font-medium text-ink">
              Status
            </label>
            <Select id="status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">All</option>
              {Object.values(ChargebackStatus).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          <label className="flex items-center gap-2 pb-2 text-sm text-ink">
            <input
              type="checkbox"
              name="overdueOnly"
              value="1"
              defaultChecked={filters.overdueOnly}
              className="size-4 rounded border-line-strong"
            />
            Past deadline only
          </label>

          <Button type="submit">
            <Search />
            Search
          </Button>

          {filters.q || filters.status || filters.overdueOnly ? (
            <Link href="/admin/chargebacks" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </form>

        <TableShell>
          <Thead>
            <Tr>
              <Th>Reference</Th>
              <Th>Booking</Th>
              <Th align="right">Disputed</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
              <Th>Deadline</Th>
              <Th align="right">Evidence</Th>
              <Th>Assigned</Th>
              <Th align="right">Outcome</Th>
            </Tr>
          </Thead>

          <Tbody>
            {result.rows.length === 0 ? (
              <EmptyState
                colSpan={9}
                title="No chargebacks"
                description="Cases are opened from a booking when a dispute is received."
              />
            ) : (
              result.rows.map((chargeback) => {
                const isOpen = OPEN_STATUSES.includes(chargeback.status);
                const pastDeadline =
                  isOpen && chargeback.respondBy && isOverdue(chargeback.respondBy);

                return (
                  <Tr key={chargeback.id}>
                    <Td className="font-medium">{chargeback.reference}</Td>
                    <Td>
                      <Link
                        href={`/admin/bookings/${chargeback.booking.id}`}
                        className="text-navy-500 hover:underline"
                      >
                        {chargeback.booking.bookingNumber}
                      </Link>
                      <div className="text-xs text-ink-muted">
                        {chargeback.booking.customer.firstName}{" "}
                        {chargeback.booking.customer.lastName}
                      </div>
                    </Td>
                    <Td align="right" numeric>
                      {formatMoney(chargeback.disputedAmountMinor, chargeback.currency)}
                    </Td>
                    <Td className="max-w-56 text-ink-muted">
                      {chargeback.reasonCode ? (
                        <span className="font-medium text-ink">
                          {chargeback.reasonCode}{" "}
                        </span>
                      ) : null}
                      <span className="line-clamp-2">{chargeback.reason}</span>
                    </Td>
                    <Td>
                      <ChargebackStatusBadge status={chargeback.status} />
                      {chargeback.status === ChargebackStatus.EVIDENCE_SUBMITTED &&
                      !chargeback.submissionReference ? (
                        <div className="mt-0.5 text-xs text-ink-subtle">
                          Prepared, not filed
                        </div>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {chargeback.respondBy ? (
                        <>
                          <span
                            className={
                              pastDeadline
                                ? "font-medium text-status-danger"
                                : "text-ink-muted"
                            }
                          >
                            {formatDate(chargeback.respondBy)}
                          </span>
                          {isOpen ? (
                            <div
                              className={
                                pastDeadline
                                  ? "text-xs font-medium text-status-danger"
                                  : "text-xs text-ink-subtle"
                              }
                            >
                              {formatRelativeDays(chargeback.respondBy)}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                    <Td align="right" numeric>
                      {chargeback._count.evidence}
                    </Td>
                    <Td className="text-ink-muted">
                      {chargeback.assignedTo?.name ?? "Unassigned"}
                    </Td>
                    <Td align="right" numeric>
                      {chargeback.outcomeAmountMinor === null ? (
                        <span className="text-ink-subtle">—</span>
                      ) : (
                        <Badge
                          tone={chargeback.outcomeAmountMinor < 0 ? "danger" : "success"}
                        >
                          {formatMoney(
                            chargeback.outcomeAmountMinor,
                            chargeback.currency,
                          )}
                        </Badge>
                      )}
                    </Td>
                  </Tr>
                );
              })
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
