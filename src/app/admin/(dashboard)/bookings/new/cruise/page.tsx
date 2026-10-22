import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/admin-shell";
import { BookingProduct } from "@/generated/prisma/enums";
import { createCruiseBookingAction } from "@/features/bookings/actions";
import { CruiseBookingForm } from "@/features/bookings/cruise-booking-form";
import { requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { PERMISSIONS } from "@/lib/permissions";

export const metadata: Metadata = { title: "New cruise booking · Travel CRM" };

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.businessSetting.findUnique({
    where: { key },
    select: { value: true },
  });

  return (row?.value as T | undefined) ?? fallback;
}

export default async function NewCruiseBookingPage({
  searchParams,
}: PageProps<"/admin/bookings/new/cruise">) {
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
    currencies,
    defaultCurrency,
  ] = await Promise.all([
    prisma.customer.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, reference: true, firstName: true, lastName: true },
      orderBy: { lastName: "asc" },
      take: 500,
    }),
    prisma.adminUser.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Suppliers that handle cruise, plus those with no product restriction
    // recorded yet, so an unconfigured supplier is still selectable.
    //
    // The narrowing is done here rather than in the query. Expressed as Prisma
    // list filters — `{ has: "CRUISE" }` with `{ isEmpty: true }` — it failed
    // against the embedded database with "malformed array literal", because
    // the PGlite driver adapter binds the operand of an enum-array comparison
    // as a scalar. The hosted adapter handles it, so this page worked against
    // real Postgres and returned a 500 on the demo, which is the worst split
    // to have: a page nobody can reach in the environment people are sent to.
    //
    // Reading the column instead costs nothing worth measuring. Suppliers are
    // an operator-maintained list of tens of rows, already fetched in full by
    // the settings pages, and the filter below is exact.
    prisma.supplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true, supportedProducts: true },
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
    getSetting<string[]>("supported_currencies", ["USD"]),
    getSetting<string>("default_currency", "USD"),
  ]);

  const cruiseSuppliers = suppliers
    .filter(
      (supplier) =>
        supplier.supportedProducts.length === 0 ||
        supplier.supportedProducts.includes(BookingProduct.CRUISE),
    )
    .map(({ id, name }) => ({ id, name }));

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Create new booking"
        description="Cruise booking. Sections can be collapsed while you work."
      />

      <CruiseBookingForm
        action={createCruiseBookingAction}
        preselectedCustomerId={preselectedCustomerId}
        options={{
          customers,
          agents,
          suppliers: cruiseSuppliers,
          mcoSuppliers,
          bookingTypes,
          // Cruise bookings are not routed through a toll-free number in the
          // reference CRM, so the picker is not offered.
          tfns: [],
          currencies,
          defaultCurrency,
        }}
      />
    </div>
  );
}
