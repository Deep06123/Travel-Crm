import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";

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
import { Badge } from "@/components/ui/status-badge";
import { Input, Select } from "@/components/ui/field";
import { CustomerStatus } from "@/generated/prisma/enums";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { customerSearchSchema } from "@/features/customers/schemas";
import { listCustomers } from "@/server/services/customer-service";

export const metadata: Metadata = { title: "Customers · Travel CRM" };

const STATUS_TONES = {
  [CustomerStatus.ACTIVE]: "success",
  [CustomerStatus.INACTIVE]: "neutral",
  [CustomerStatus.BLOCKED]: "danger",
} as const;

export default async function CustomersPage({
  searchParams,
}: PageProps<"/admin/customers">) {
  await requirePermission(PERMISSIONS.CUSTOMER_VIEW);
  const canCreate = await currentUserCan(PERMISSIONS.CUSTOMER_CREATE);

  const params = await searchParams;

  // Unparseable query values fall back to defaults rather than erroring, so a
  // hand-edited URL degrades to the unfiltered list.
  const filters = customerSearchSchema.parse({
    q: params["q"],
    status: typeof params["status"] === "string" && params["status"] !== ""
      ? params["status"]
      : undefined,
    sort: params["sort"],
  });
  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const result = await listCustomers(filters, pagination);

  const buildHref = (page: number): string => {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.status) query.set("status", filters.status);
    if (filters.sort) query.set("sort", filters.sort);
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/admin/customers?${search}` : "/admin/customers";
  };

  return (
    <>
      <PageHeader
        title="Customers"
        description={`${result.total.toLocaleString()} record${result.total === 1 ? "" : "s"}`}
        actions={
          canCreate ? (
            <Link href="/admin/customers/new" className={buttonVariants()}>
              <Plus />
              New customer
            </Link>
          ) : null
        }
      />

      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        {/* A GET form keeps the active filters in the URL, so a filtered view
            can be bookmarked and shared. */}
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-ink">
              Search
            </label>
            <Input
              id="q"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Name, email, phone, reference or booking number"
            />
          </div>

          <div className="w-44">
            <label htmlFor="status" className="mb-1.5 block text-sm font-medium text-ink">
              Status
            </label>
            <Select id="status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">All statuses</option>
              <option value={CustomerStatus.ACTIVE}>Active</option>
              <option value={CustomerStatus.INACTIVE}>Inactive</option>
              <option value={CustomerStatus.BLOCKED}>Blocked</option>
            </Select>
          </div>

          <Button type="submit">
            <Search />
            Search
          </Button>

          {filters.q || filters.status ? (
            <Link href="/admin/customers" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </form>

        <TableShell>
          <Thead>
            <Tr>
              <Th>Reference</Th>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Phone</Th>
              <Th align="right">Bookings</Th>
              <Th>Status</Th>
              <Th>Created</Th>
            </Tr>
          </Thead>

          <Tbody>
            {result.rows.length === 0 ? (
              <EmptyState
                colSpan={7}
                title={filters.q || filters.status ? "No matching customers" : "No customers yet"}
                description={
                  filters.q || filters.status
                    ? "Try a different search term or clear the filters."
                    : "Customers are created here or from a new booking."
                }
                action={
                  canCreate && !filters.q && !filters.status ? (
                    <Link href="/admin/customers/new" className={buttonVariants()}>
                      <Plus />
                      New customer
                    </Link>
                  ) : null
                }
              />
            ) : (
              result.rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Link
                      href={`/admin/customers/${row.id}`}
                      className="font-medium text-navy-500 hover:underline"
                    >
                      {row.reference}
                    </Link>
                  </Td>
                  <Td>
                    {row.firstName} {row.lastName}
                  </Td>
                  <Td className="text-ink-muted">{row.email ?? "—"}</Td>
                  <Td className="text-ink-muted">{row.phone ?? "—"}</Td>
                  <Td align="right" numeric>
                    {row.bookingCount}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONES[row.status]}>
                      {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
                    </Badge>
                  </Td>
                  <Td className="text-ink-muted whitespace-nowrap">
                    {formatDate(row.createdAt)}
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
