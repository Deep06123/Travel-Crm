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
import { Badge, PriorityBadge } from "@/components/ui/status-badge";
import { BookingPriority, ServiceCaseStatus } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { formatDate, formatDateTime } from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { listServiceCases } from "@/server/services/operations-service";

export const metadata: Metadata = { title: "Customer service · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const STATUS_TONES = {
  [ServiceCaseStatus.OPEN]: "warning",
  [ServiceCaseStatus.IN_PROGRESS]: "info",
  [ServiceCaseStatus.WAITING_ON_CUSTOMER]: "neutral",
  [ServiceCaseStatus.RESOLVED]: "success",
  [ServiceCaseStatus.CLOSED]: "neutral",
} as const;

export default async function CustomerServicePage({
  searchParams,
}: PageProps<"/admin/customer-service">) {
  await requirePermission(PERMISSIONS.SERVICE_CASE_VIEW);

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const rawStatus = pick("status");
  const rawPriority = pick("priority");

  const filters = {
    q: pick("q"),
    status:
      rawStatus && rawStatus in ServiceCaseStatus
        ? (rawStatus as ServiceCaseStatus)
        : undefined,
    priority:
      rawPriority && rawPriority in BookingPriority
        ? (rawPriority as BookingPriority)
        : undefined,
    assignedToId: pick("assignedToId"),
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const [result, agents] = await Promise.all([
    listServiceCases(filters, pagination),
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
    return search ? `/admin/customer-service?${search}` : "/admin/customer-service";
  };

  return (
    <>
      <PageHeader
        title="Customer service"
        description={`${result.total.toLocaleString()} case${result.total === 1 ? "" : "s"}`}
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
              placeholder="Case number, category, description, customer or booking"
            />
          </div>

          <div className="w-48">
            <label htmlFor="status" className="mb-1.5 block text-sm font-medium text-ink">
              Status
            </label>
            <Select id="status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">All</option>
              {Object.values(ServiceCaseStatus).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-40">
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

          <div className="w-48">
            <label htmlFor="assignedToId" className="mb-1.5 block text-sm font-medium text-ink">
              Assigned
            </label>
            <Select
              id="assignedToId"
              name="assignedToId"
              defaultValue={filters.assignedToId ?? ""}
            >
              <option value="">Anyone</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </Select>
          </div>

          <Button type="submit">
            <Search />
            Search
          </Button>

          {Object.values(filters).some(Boolean) ? (
            <Link
              href="/admin/customer-service"
              className={buttonVariants({ variant: "ghost" })}
            >
              Clear
            </Link>
          ) : null}
        </form>

        <TableShell>
          <Thead>
            <Tr>
              <Th>Case</Th>
              <Th>Customer</Th>
              <Th>Booking</Th>
              <Th>Category</Th>
              <Th>Priority</Th>
              <Th>Status</Th>
              <Th>Assigned</Th>
              <Th>Opened</Th>
            </Tr>
          </Thead>

          <Tbody>
            {result.rows.length === 0 ? (
              <EmptyState
                colSpan={8}
                title="No cases"
                description="Service cases are opened against a customer, optionally tied to a booking."
              />
            ) : (
              result.rows.map((serviceCase) => (
                <Tr key={serviceCase.id}>
                  <Td>
                    <span className="font-medium">{serviceCase.caseNumber}</span>
                    <div className="max-w-56 text-xs text-ink-muted line-clamp-2">
                      {serviceCase.description}
                    </div>
                  </Td>
                  <Td>
                    <Link
                      href={`/admin/customers/${serviceCase.customer.id}`}
                      className="text-navy-500 hover:underline"
                    >
                      {serviceCase.customer.firstName} {serviceCase.customer.lastName}
                    </Link>
                  </Td>
                  <Td>
                    {serviceCase.booking ? (
                      <Link
                        href={`/admin/bookings/${serviceCase.booking.id}`}
                        className="text-navy-500 hover:underline"
                      >
                        {serviceCase.booking.bookingNumber}
                      </Link>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </Td>
                  <Td className="text-ink-muted">{serviceCase.category}</Td>
                  <Td>
                    <PriorityBadge level={serviceCase.priority} />
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONES[serviceCase.status]}>
                      {humanise(serviceCase.status)}
                    </Badge>
                    {serviceCase.resolvedAt ? (
                      <div className="text-xs text-ink-subtle">
                        {formatDate(serviceCase.resolvedAt)}
                      </div>
                    ) : null}
                  </Td>
                  <Td className="text-ink-muted">
                    {serviceCase.assignedTo?.name ?? "Unassigned"}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {formatDateTime(serviceCase.createdAt)}
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
