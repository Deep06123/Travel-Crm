"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/dal";
import { retainedFormValues } from "@/lib/forms";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  CustomerInUseError,
  DuplicateCustomerError,
  createCustomer,
  deleteCustomer,
  setCustomerStatus,
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

/**
 * Retains what the operator typed so a rejected form is not emptied.
 *
 * `confirmedDuplicate` is deliberately dropped: the override applies to the
 * submission that carried it, and remembering it would silently wave through
 * a duplicate the operator never looked at twice.
 */
function formValues(formData: FormData): Record<string, string> {
  return retainedFormValues(formData, { omit: ["confirmedDuplicate"] });
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

// --- Removal ----------------------------------------------------------------

export interface CustomerRemovalState {
  error?: string;
  success?: string;
}

/**
 * Deletes a customer, or marks them inactive where deleting is refused.
 *
 * One action for both because they are one control in the list: which it is
 * depends on whether anything references the record, and the row already
 * knows that from the booking count it renders.
 *
 * `customer.delete` rather than `customer.update`: taking a customer off the
 * books is a different decision from correcting their phone number, and the
 * default grants give it to SUPER_ADMIN alone.
 */
export async function removeCustomerAction(
  _previous: CustomerRemovalState,
  formData: FormData,
): Promise<CustomerRemovalState> {
  const user = await requirePermission(PERMISSIONS.CUSTOMER_DELETE);

  const customerId = String(formData.get("customerId") ?? "").trim();
  if (customerId === "") return { error: "Invalid request." };

  const deactivating = formData.get("deactivate") === "true";

  try {
    if (deactivating) {
      await setCustomerStatus(customerId, "INACTIVE", user.id);
      revalidatePath("/admin/customers");
      revalidatePath(`/admin/customers/${customerId}`);
      return {
        success:
          "Customer marked inactive. Their bookings and history are unchanged.",
      };
    }

    await deleteCustomer(customerId, user.id);
  } catch (error) {
    // Already explains what is holding the record and what to do instead.
    if (error instanceof CustomerInUseError) return { error: error.message };

    log.error({ err: error, customerId }, "Failed to remove customer");
    return { error: "The customer could not be removed. Try again." };
  }

  revalidatePath("/admin/customers");
  return { success: "Customer deleted." };
}

/** Puts an inactive or blocked customer back in circulation. */
export async function reactivateCustomerAction(
  _previous: CustomerRemovalState,
  formData: FormData,
): Promise<CustomerRemovalState> {
  const user = await requirePermission(PERMISSIONS.CUSTOMER_DELETE);

  const customerId = String(formData.get("customerId") ?? "").trim();
  if (customerId === "") return { error: "Invalid request." };

  try {
    await setCustomerStatus(customerId, "ACTIVE", user.id);
  } catch (error) {
    log.error({ err: error, customerId }, "Failed to reactivate customer");
    return { error: "The customer could not be reactivated. Try again." };
  }

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${customerId}`);
  return { success: "Customer is active again." };
}
