"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/dal";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  DuplicateCustomerError,
  createCustomer,
  updateCustomer,
  type DuplicateMatch,
} from "@/server/services/customer-service";

import { createCustomerSchema, updateCustomerSchema } from "./schemas";

const log = loggerFor("customer-actions");

export interface CustomerFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Populated when the submission looks like an existing customer. */
  duplicates?: DuplicateMatch[];
  values?: Record<string, string>;
}

/** Collects the first message per field, which is what the form displays. */
function collectFieldErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }

  return fieldErrors;
}

/** Retains what the operator typed so a rejected form is not emptied. */
function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && key !== "confirmedDuplicate") {
      values[key] = value;
    }
  }

  return values;
}

function toObject(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(formData.entries());
}

export async function createCustomerAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const user = await requirePermission(PERMISSIONS.CUSTOMER_CREATE);

  const parsed = createCustomerSchema.safeParse(toObject(formData));

  if (!parsed.success) {
    return {
      fieldErrors: collectFieldErrors(parsed.error.issues),
      values: formValues(formData),
    };
  }

  let created: { id: string };

  try {
    created = await createCustomer(parsed.data, user.id);
  } catch (error) {
    if (error instanceof DuplicateCustomerError) {
      // Not a failure: the operator is shown the matches and may confirm.
      return {
        duplicates: error.matches,
        values: formValues(formData),
      };
    }

    log.error({ err: error }, "Failed to create customer");
    return {
      error: "The customer could not be saved. Try again.",
      values: formValues(formData),
    };
  }

  revalidatePath("/admin/customers");
  redirect(`/admin/customers/${created.id}`);
}

export async function updateCustomerAction(
  customerId: string,
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const user = await requirePermission(PERMISSIONS.CUSTOMER_UPDATE);

  const parsed = updateCustomerSchema.safeParse(toObject(formData));

  if (!parsed.success) {
    return {
      fieldErrors: collectFieldErrors(parsed.error.issues),
      values: formValues(formData),
    };
  }

  try {
    await updateCustomer(customerId, parsed.data, user.id);
  } catch (error) {
    log.error({ err: error, customerId }, "Failed to update customer");
    return {
      error: "The changes could not be saved. Try again.",
      values: formValues(formData),
    };
  }

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customers");
  redirect(`/admin/customers/${customerId}?saved=1`);
}
