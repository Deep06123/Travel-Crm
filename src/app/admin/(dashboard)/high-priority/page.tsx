import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

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
import {
  BookingStatusBadge,
  PriorityBadge,
} from "@/components/ui/status-badge";
import { BookingPriority } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/financial/money";
import {
  formatCalendarDate,
  formatRelativeDays,
  isOverdue,
} from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { listHighPriorityBookings } from "@/server/services/operations-service";

export const metadata: Metadata = { title: "High priority · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export default async function HighPriorityPage({
  searchParams,
}: PageProps<"/admin/high-priority">) {
  await requirePermission(PERMISSIONS.BOOKING_VIEW);

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const rawPriority = pick("priority");

  const filters = {
    q: pick("q"),
    priority:
      rawPriority && rawPriority in BookingPriority
        ? (rawPriority as BookingPriority)
        : undefined,
    assigneeId: pick("assigneeId"),
    overdueOnly: pick("overdueOnly") === "1",
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const [result, agents] = await Promise.all([
    listHighPriorityBookings(filters, pagination),
    prisma.adminUser.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const buildHref = (page: number): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value !== "" && key !== "page") {
        query.set(key, value);
      }
    }
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/admin/high-priority?${search}` : "/admin/high-priority";
  };

  return (
    <>
      <PageHeader
        title="High priority bookings"
        description={`${result.total.toLocaleString()} open booking${result.total === 1 ? "" : "s"} marked high or urgent`}
      />

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
              placeholder="Booking number or customer"
            />
          </div>

          <div className="w-40">
            <label htmlFor="priority" className="mb-1.5 block text-sm font-medium text-ink">
              Priority
            </label>
            <Select id="priority" name="priority" defaultValue={filters.priority ?? ""}>
              <option value="">High and urgent</option>
              {Object.values(BookingPriority).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-48">
            <label htmlFor="assigneeId" className="mb-1.5 block text-sm font-medium text-ink">
              Assigned
            </label>
            <Select id="assigneeId" name="assigneeId" defaultValue={filters.assigneeId ?? ""}>
              <option value="">Anyone</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
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
            Overdue only
          </label>

          <Button type="submit">
            <Search />
            Search
          </Button>

          {Object.values(filters).some(Boolean) ? (
            <Link href="/admin/high-priority" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </form>

        <TableShell>
          <Thead>
            <Tr>
              <Th>Booking</Th>
              <Th>Customer</Th>
              <Th>Priority</Th>
              <Th>Status</Th>
              <Th>Open follow-up</Th>
              <Th>Due</Th>
              <Th>Assigned</Th>
              <Th align="right">Value</Th>
              <Th>Travel</Th>
            </Tr>
          </Thead>

          <Tbody>
            {result.rows.length === 0 ? (
              <EmptyState
                colSpan={9}
                title="Nothing high priority"
                description="Bookings escalated to high or urgent appear here while they stay open."
              />
            ) : (
              result.rows.map((booking) => {
                const followUp = booking.followUps[0];
                const overdue = followUp ? isOverdue(followUp.dueAt) : false;

                return (
                  <Tr key={booking.id}>
                    <Td>
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className="font-medium text-navy-500 hover:underline"
                      >
                        {booking.bookingNumber}
                      </Link>
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/customers/${booking.customer.id}`}
                        className="hover:underline"
                      >
                        {booking.customer.firstName} {booking.customer.lastName}
                      </Link>
                    </Td>
                    <Td>
                      <PriorityBadge level={booking.priority} />
                    </Td>
                    <Td>
                      <BookingStatusBadge status={booking.status} />
                    </Td>
                    <Td className="max-w-56 text-ink-muted">
                      {followUp ? (
                        <span className="line-clamp-2">{followUp.reason}</span>
                      ) : (
                        <span className="text-ink-subtle">None</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {followUp ? (
                        <span
                          className={
                            overdue
                              ? "font-medium text-status-danger"
                              : "text-ink-muted"
                          }
                        >
                          {formatRelativeDays(followUp.dueAt)}
                        </span>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                    <Td className="text-ink-muted">
                      {booking.assignedAgent?.name ?? "Unassigned"}
                    </Td>
                    <Td align="right" numeric>
                      {formatMoney(booking.totalMinor, booking.currency)}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-muted">
                      {booking.travelStartDate
                        ? formatCalendarDate(booking.travelStartDate)
                        : "—"}
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
