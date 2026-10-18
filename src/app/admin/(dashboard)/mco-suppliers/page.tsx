import type { Metadata } from "next";

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
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/status-badge";
import { McoSupplierForm } from "@/features/admin/reference-forms";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import { listMcoSuppliers } from "@/server/services/reference-data-service";

export const metadata: Metadata = { title: "MCO suppliers · Travel CRM" };

export default async function McoSuppliersPage() {
  await requirePermission(PERMISSIONS.SUPPLIER_VIEW);
  const canManage = await currentUserCan(PERMISSIONS.SUPPLIER_MANAGE);

  const suppliers = await listMcoSuppliers();

  return (
    <>
      <PageHeader
        title="MCO suppliers"
        description="Suppliers used to settle MCO balances. Reported separately from booking suppliers."
      />

      <div className="grid gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
            <TableShell>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Mail from</Th>
                  <Th>Contact</Th>
                  <Th align="right">Bookings</Th>
                  <Th>Status</Th>
                  <Th>Added</Th>
                </Tr>
              </Thead>
              <Tbody>
                {suppliers.length === 0 ? (
                  <EmptyState colSpan={6} title="No MCO suppliers yet" />
                ) : (
                  suppliers.map((supplier) => (
                    <Tr key={supplier.id}>
                      <Td className="font-medium">{supplier.name}</Td>
                      <Td className="text-ink-muted">{supplier.mailFrom ?? "—"}</Td>
                      <Td className="text-ink-muted">
                        {supplier.contactEmail ?? "—"}
                        {supplier.contactPhone ? (
                          <div className="text-xs text-ink-subtle">
                            {supplier.contactPhone}
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
            <Panel title="Add MCO supplier" collapsible={false}>
              <McoSupplierForm />
            </Panel>
          </div>
        ) : null}
      </div>
    </>
  );
}
