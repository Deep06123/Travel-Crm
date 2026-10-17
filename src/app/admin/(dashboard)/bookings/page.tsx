import type { Metadata } from "next";
import Link from "next/link";
import { Plane, Search, Ship } from "lucide-react";

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
  McoStatusBadge,
  PriorityBadge,
  TicketStatusBadge,
} from "@/components/ui/status-badge";
import {
  BookingPriority,
  BookingStatus,
  McoStatus,
  TicketStatus,
} from "@/generated/prisma/enums";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/financial/money";
import { formatDateTime, formatRelativeDays, isOverdue } from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { bookingSearchSchema } from "@/features/bookings/schemas";
import { listBookings } from "@/server/services/booking-service";

export const metadata: Metadata = { title: "Bookings · Travel CRM" };

/** Turns an enum value into a readable label, e.g. NEEDS_REVIEW → Needs review. */
function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export default async function BookingsPage({
  searchParams,
}: PageProps<"/admin/bookings">) {
  await requirePermission(PERMISSIONS.BOOKING_VIEW);
  const [canCreate, canViewMoney] = await Promise.all([
    currentUserCan(PERMISSIONS.BOOKING_CREATE),
    currentUserCan(PERMISSIONS.PAYMENT_VIEW),
  ]);

  const params = await searchParams;

  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const filters = bookingSearchSchema.parse({
    q: pick("q"),
    status: pick("status"),
    ticketStatus: pick("ticketStatus"),
    mcoStatus: pick("mcoStatus"),
    priority: pick("priority"),
    agentId: pick("agentId"),
    supplierId: pick("supplierId"),
    currency: pick("currency"),
    from: pick("from"),
    to: pick("to"),
    sort: pick("sort"),
  });

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const [result, agents, suppliers] = await Promise.all([
    listBookings(filters, pagination),
    prisma.adminUser.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.supplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const activeFilters = Object.entries(filters).filter(
    ([key, value]) => value !== undefined && key !== "sort",
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
    return search ? `/admin/bookings?${search}` : "/admin/bookings";
  };

  const columnCount = canViewMoney ? 9 : 8;

  return (
    <>
      <PageHeader
        title="All bookings"
        description={`${result.total.toLocaleString()} booking${result.total === 1 ? "" : "s"}`}
        actions={
          canCreate ? (
            <>
              <Link
                href="/admin/bookings/new/flight"
                className={buttonVariants()}
              >
                <Plane />
                New flight
              </Link>
            </>
          ) : null
        }
      />

      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <form method="get" className="border-b border-line p-4">
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
            <div className="md:col-span-2">
              <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-ink">
                Search
              </label>
              <Input
                id="q"
                name="q"
                defaultValue={filters.q ?? ""}
                placeholder="Booking no., PNR, confirmation, name, email, phone or ticket no."
              />
            </div>

            <div>
              <label htmlFor="status" className="mb-1.5 block text-sm font-medium text-ink">
                Booking status
              </label>
              <Select id="status" name="status" defaultValue={filters.status ?? ""}>
                <option value="">All</option>
                {Object.values(BookingStatus).map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label htmlFor="ticketStatus" className="mb-1.5 block text-sm font-medium text-ink">
                Ticket status
              </label>
              <Select
                id="ticketStatus"
                name="ticketStatus"
                defaultValue={filters.ticketStatus ?? ""}
              >
                <option value="">All</option>
                {Object.values(TicketStatus).map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label htmlFor="mcoStatus" className="mb-1.5 block text-sm font-medium text-ink">
                MCO status
              </label>
              <Select id="mcoStatus" name="mcoStatus" defaultValue={filters.mcoStatus ?? ""}>
                <option value="">All</option>
                {Object.values(McoStatus).map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label htmlFor="priority" className="mb-1.5 block text-sm font-medium text-ink">
                Priority
              </label>
              <Select id="priority" name="priority" defaultValue={filters.priority ?? ""}>
                <option value="">All</option>
                {Object.values(BookingPriority).map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label htmlFor="agentId" className="mb-1.5 block text-sm font-medium text-ink">
                Agent
              </label>
              <Select id="agentId" name="agentId" defaultValue={filters.agentId ?? ""}>
                <option value="">All agents</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label htmlFor="supplierId" className="mb-1.5 block text-sm font-medium text-ink">
                Supplier
              </label>
              <Select id="supplierId" name="supplierId" defaultValue={filters.supplierId ?? ""}>
                <option value="">All suppliers</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label htmlFor="from" className="mb-1.5 block text-sm font-medium text-ink">
                Booked from
              </label>
              <Input
                id="from"
                name="from"
                type="date"
                defaultValue={
                  typeof params["from"] === "string" ? params["from"] : ""
                }
              />
            </div>

            <div>
              <label htmlFor="to" className="mb-1.5 block text-sm font-medium text-ink">
                Booked to
              </label>
              <Input
                id="to"
                name="to"
                type="date"
                defaultValue={typeof params["to"] === "string" ? params["to"] : ""}
              />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button type="submit">
              <Search />
              Search
            </Button>
            {activeFilters > 0 ? (
              <Link href="/admin/bookings" className={buttonVariants({ variant: "ghost" })}>
                Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
              </Link>
            ) : null}
          </div>
        </form>

        <TableShell>
          <Thead>
            <Tr>
              <Th>Booking no. &amp; type</Th>
              <Th>Customer</Th>
              <Th>Confirmation</Th>
              {canViewMoney ? <Th align="right">Gross / net MCO</Th> : null}
              <Th>Booking status</Th>
              <Th>Ticketing</Th>
              <Th>MCO</Th>
              <Th>Agent</Th>
              <Th>Booked</Th>
            </Tr>
          </Thead>

          <Tbody>
            {result.rows.length === 0 ? (
              <EmptyState
                colSpan={columnCount}
                title={activeFilters > 0 ? "No matching bookings" : "No bookings yet"}
                description={
                  activeFilters > 0
                    ? "Try widening the date range or clearing a filter."
                    : "Create a flight or cruise booking to get started."
                }
                action={
                  canCreate && activeFilters === 0 ? (
                    <Link href="/admin/bookings/new/flight" className={buttonVariants()}>
                      <Plane />
                      New flight booking
                    </Link>
                  ) : null
                }
              />
            ) : (
              result.rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Link
                      href={`/admin/bookings/${row.id}`}
                      className="font-medium text-navy-500 hover:underline"
                    >
                      {row.bookingNumber}
                    </Link>
                    <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                      {row.product === "FLIGHT" ? (
                        <Plane className="size-3" />
                      ) : (
                        <Ship className="size-3" />
                      )}
                      {row.bookingType?.label ?? humanise(row.product)}
                    </div>
                    {row.priority !== BookingPriority.NORMAL ? (
                      <div className="mt-1">
                        <PriorityBadge level={row.priority} />
                      </div>
                    ) : null}
                  </Td>

                  <Td>
                    <Link
                      href={`/admin/customers/${row.customer.id}`}
                      className="hover:underline"
                    >
                      {row.customer.firstName} {row.customer.lastName}
                    </Link>
                    {row.customer.email ? (
                      <div className="text-xs text-ink-muted">{row.customer.email}</div>
                    ) : null}
                  </Td>

                  <Td className="text-ink-muted">{row.airlineConfirmation ?? "—"}</Td>

                  {canViewMoney ? (
                    <Td align="right" numeric>
                      <div>{formatMoney(row.grossMcoMinor, row.currency)}</div>
                      <div className="text-xs text-ink-muted">
                        {formatMoney(row.netMcoMinor, row.currency)}
                      </div>
                    </Td>
                  ) : null}

                  <Td>
                    <BookingStatusBadge status={row.status} />
                  </Td>
                  <Td>
                    <TicketStatusBadge status={row.ticketStatus} />
                  </Td>
                  <Td>
                    <McoStatusBadge status={row.mcoStatus} />
                  </Td>

                  <Td className="text-ink-muted">{row.assignedAgent?.name ?? "—"}</Td>

                  <Td className="whitespace-nowrap text-ink-muted">
                    {formatDateTime(row.bookedAt)}
                    {row.followUpAt ? (
                      <div
                        className={
                          isOverdue(row.followUpAt)
                            ? "text-xs font-medium text-status-danger"
                            : "text-xs text-ink-subtle"
                        }
                      >
                        Follow-up {formatRelativeDays(row.followUpAt)}
                      </div>
                    ) : null}
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
