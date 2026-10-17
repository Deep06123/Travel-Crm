import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/admin-shell";
import { CustomerForm } from "@/features/customers/customer-form";
import { createCustomerAction } from "@/features/customers/actions";
import { requirePermission } from "@/lib/auth/dal";
import { PERMISSIONS } from "@/lib/permissions";

export const metadata: Metadata = { title: "New customer · Travel CRM" };

export default async function NewCustomerPage() {
  await requirePermission(PERMISSIONS.CUSTOMER_CREATE);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="New customer"
        description="Existing records with the same email or phone number are flagged before saving."
      />

      <CustomerForm
        action={createCustomerAction}
        submitLabel="Create customer"
        cancelHref="/admin/customers"
      />
    </div>
  );
}
