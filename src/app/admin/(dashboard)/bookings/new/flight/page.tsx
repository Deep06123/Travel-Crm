import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/admin-shell";
import { createFlightBookingAction } from "@/features/bookings/actions";
import { FlightBookingForm } from "@/features/bookings/flight-booking-form";
import { requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { PERMISSIONS } from "@/lib/permissions";

export const metadata: Metadata = { title: "New flight booking · Travel CRM" };

/** Reads a business setting, falling back when it is absent or malformed. */
async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.businessSetting.findUnique({
    where: { key },
    select: { value: true },
  });

  return (row?.value as T | undefined) ?? fallback;
}

export default async function NewFlightBookingPage({
  searchParams,
}: PageProps<"/admin/bookings/new/flight">) {
  await requirePermission(PERMISSIONS.BOOKING_CREATE);

  const params = await searchParams;
  const preselectedCustomerId =
    typeof params["customerId"] === "string" ? params["customerId"] : undefined;

  const [
    customers,
    agents,
    suppliers,
    mcoSuppliers,
    bookingTypes,
    tfns,
    currencies,
    defaultCurrency,
  ] = await Promise.all([
    prisma.customer.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, reference: true, firstName: true, lastName: true },
      orderBy: { lastName: "asc" },
      // The picker is a plain select for now; a type-ahead replaces it once the
      // customer list outgrows this.
      take: 500,
    }),
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
    prisma.mcoSupplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.bookingType.findMany({
      where: { isActive: true },
      select: { id: true, label: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.tfn.findMany({
      where: { isActive: true },
      select: { id: true, number: true, label: true },
      orderBy: { label: "asc" },
    }),
    getSetting<string[]>("supported_currencies", ["USD"]),
    getSetting<string>("default_currency", "USD"),
  ]);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Create new booking"
        description="Flight booking. Sections can be collapsed while you work."
      />

      <FlightBookingForm
        action={createFlightBookingAction}
        preselectedCustomerId={preselectedCustomerId}
        options={{
          customers,
          agents,
          suppliers,
          mcoSuppliers,
          bookingTypes,
          tfns,
          currencies,
          defaultCurrency,
        }}
      />
    </div>
  );
}
