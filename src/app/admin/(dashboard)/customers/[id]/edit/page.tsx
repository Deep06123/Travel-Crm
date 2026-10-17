import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/admin-shell";
import { updateCustomerAction } from "@/features/customers/actions";
import { CustomerForm } from "@/features/customers/customer-form";
import { requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { PERMISSIONS } from "@/lib/permissions";

export const metadata: Metadata = { title: "Edit customer · Travel CRM" };

export default async function EditCustomerPage({
  params,
}: PageProps<"/admin/customers/[id]/edit">) {
  await requirePermission(PERMISSIONS.CUSTOMER_UPDATE);

  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      reference: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      status: true,
      billingAddressLine1: true,
      billingAddressLine2: true,
      billingCity: true,
      billingState: true,
      billingPostalCode: true,
      billingCountry: true,
      preferredLanguage: true,
      notes: true,
    },
  });

  if (!customer) notFound();

  // Bind the id server-side so the browser cannot retarget the update at a
  // different customer by editing a hidden field.
  const action = updateCustomerAction.bind(null, customer.id);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={`Edit ${customer.firstName} ${customer.lastName}`}
        description={customer.reference}
      />

      <CustomerForm
        action={action}
        submitLabel="Save changes"
        cancelHref={`/admin/customers/${customer.id}`}
        defaults={{
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email ?? "",
          phone: customer.phone ?? "",
          status: customer.status,
          billingAddressLine1: customer.billingAddressLine1 ?? "",
          billingAddressLine2: customer.billingAddressLine2 ?? "",
          billingCity: customer.billingCity ?? "",
          billingState: customer.billingState ?? "",
          billingPostalCode: customer.billingPostalCode ?? "",
          billingCountry: customer.billingCountry ?? "",
          preferredLanguage: customer.preferredLanguage ?? "",
          notes: customer.notes ?? "",
        }}
      />
    </div>
  );
}
