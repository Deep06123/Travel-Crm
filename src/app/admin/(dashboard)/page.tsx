import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/admin-shell";
import { Card, Panel } from "@/components/ui/panel";
import { requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { PERMISSIONS } from "@/lib/permissions";

export const metadata: Metadata = { title: "Dashboard · Travel CRM" };

/**
 * Dashboard.
 *
 * Phase 1 renders the shell and a live record count so the database connection
 * is visibly exercised end to end. The KPI cards, trend charts and supplier and
 * agent performance tables arrive in Phase 2, once bookings exist to measure —
 * the plan is explicit that no figure here may be hard-coded.
 */
export default async function DashboardPage() {
  const user = await requirePermission(PERMISSIONS.BOOKING_VIEW);

  const [bookings, customers, admins] = await Promise.all([
    prisma.booking.count(),
    prisma.customer.count(),
    prisma.adminUser.count(),
  ]);

  const counts = [
    { label: "Bookings", value: bookings },
    { label: "Customers", value: customers },
    { label: "Administrators", value: admins },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Signed in as ${user.name} · ${user.role}`}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {counts.map((count) => (
          <Card key={count.label}>
            <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
              {count.label}
            </p>
            <p className="tabular mt-1 text-3xl font-semibold text-navy-500">
              {count.value.toLocaleString()}
            </p>
          </Card>
        ))}
      </div>

      <Panel title="Operational overview" collapsible={false}>
        <p className="text-sm text-ink-muted">
          KPI cards, booking trends, supplier and agent performance, pending
          ticketing and overdue follow-ups are built in Phase 2 against real
          booking data. Every figure shown here is read from PostgreSQL.
        </p>
      </Panel>
    </>
  );
}
