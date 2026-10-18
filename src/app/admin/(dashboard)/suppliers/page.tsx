import type { Metadata } from "next";
import { Info } from "lucide-react";

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
import { SupplierForm } from "@/features/admin/reference-forms";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import { listSuppliers } from "@/server/services/reference-data-service";

export const metadata: Metadata = { title: "Suppliers · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export default async function SuppliersPage() {
  await requirePermission(PERMISSIONS.SUPPLIER_VIEW);
  const canManage = await currentUserCan(PERMISSIONS.SUPPLIER_MANAGE);

  const suppliers = await listSuppliers();

  return (
    <>
      <PageHeader
        title="Suppliers"
        description={`${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"}`}
      />

      <Card className="mb-4">
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          These are directory entries. Adding a supplier does not create a live
          connection to an airline or cruise line — booking and ticketing with
          them stays a manual process until an integration is configured.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
            <TableShell>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Products</Th>
                  <Th>Contact</Th>
                  <Th align="right">Bookings</Th>
                  <Th>Status</Th>
                  <Th>Added</Th>
                </Tr>
              </Thead>
              <Tbody>
                {suppliers.length === 0 ? (
                  <EmptyState colSpan={7} title="No suppliers yet" />
                ) : (
                  suppliers.map((supplier) => (
                    <Tr key={supplier.id}>
                      <Td>
                        <span className="font-medium">{supplier.name}</span>
                        {supplier.externalId ? (
                          <div className="text-xs text-ink-muted">
                            {supplier.externalId}
                          </div>
                        ) : null}
                      </Td>
                      <Td className="text-ink-muted">{humanise(supplier.type)}</Td>
                      <Td>
                        {supplier.supportedProducts.length === 0 ? (
                          <span className="text-xs text-ink-subtle">Any</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {supplier.supportedProducts.map((product) => (
                              <Badge key={product} tone="neutral">
                                {humanise(product)}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </Td>
                      <Td className="text-ink-muted">
                        {supplier.contactName ?? "—"}
                        {supplier.contactEmail ? (
                          <div className="text-xs text-ink-subtle">
                            {supplier.contactEmail}
                          </div>
                        ) : null}
                      </Td>
                      <Td align="right" numeric>
                        {supplier._count.bookings}
                      </Td>
                      <Td>
                        <Badge tone={supplier.isActive ? "success" : "neutral"}>
                          {supplier.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-ink-muted">
                        {formatDate(supplier.createdAt)}
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </TableShell>
          </div>
        </div>

        {canManage ? (
          <div>
            <Panel title="Add supplier" collapsible={false}>
              <SupplierForm />
            </Panel>
          </div>
        ) : null}
      </div>
    </>
  );
}
