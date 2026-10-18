"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { BookingProduct, SupplierType } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/dal";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  createMcoSupplier,
  createSupplier,
  createTfn,
  updateMcoSupplier,
  updateSupplier,
  updateTfn,
  upsertBookingType,
} from "@/server/services/reference-data-service";

const log = loggerFor("reference-actions");

export interface ReferenceFormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
}

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

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .refine(
    (value) => value === "" || z.email().safeParse(value).success,
    "Enter a valid email address.",
  )
  .optional();

// --- Suppliers --------------------------------------------------------------

const supplierSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(1, "Enter a name.").max(120),
  type: z.enum(SupplierType),
  externalId: z.string().trim().max(80).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactEmail: optionalEmail,
  contactPhone: z.string().trim().max(40).optional(),
  supportsFlight: z.coerce.boolean().default(false),
  supportsCruise: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
  notes: z.string().trim().max(2_000).optional(),
});

export async function saveSupplierAction(
  _previous: ReferenceFormState,
  formData: FormData,
): Promise<ReferenceFormState> {
  const user = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);

  const parsed = supplierSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  const supportedProducts: BookingProduct[] = [];
  if (parsed.data.supportsFlight) supportedProducts.push(BookingProduct.FLIGHT);
  if (parsed.data.supportsCruise) supportedProducts.push(BookingProduct.CRUISE);

  const input = {
    name: parsed.data.name,
    type: parsed.data.type,
    externalId: parsed.data.externalId || undefined,
    contactName: parsed.data.contactName || undefined,
    contactEmail: parsed.data.contactEmail || undefined,
    contactPhone: parsed.data.contactPhone || undefined,
    supportedProducts,
    isActive: parsed.data.isActive,
    notes: parsed.data.notes || undefined,
  };

  try {
    if (parsed.data.id) {
      await updateSupplier(parsed.data.id, input, user.id);
    } else {
      await createSupplier(input, user.id);
    }
  } catch (error) {
    log.error({ err: error }, "Failed to save supplier");
    return { error: "The supplier could not be saved. A name must be unique." };
  }

  revalidatePath("/admin/suppliers");
  return { success: parsed.data.id ? "Supplier updated." : "Supplier added." };
}

// --- MCO suppliers ----------------------------------------------------------

const mcoSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(1, "Enter a name.").max(120),
  mailFrom: optionalEmail,
  contactEmail: optionalEmail,
  contactPhone: z.string().trim().max(40).optional(),
  isActive: z.coerce.boolean().default(true),
  notes: z.string().trim().max(2_000).optional(),
});

export async function saveMcoSupplierAction(
  _previous: ReferenceFormState,
  formData: FormData,
): Promise<ReferenceFormState> {
  const user = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);

  const parsed = mcoSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  const input = {
    name: parsed.data.name,
    mailFrom: parsed.data.mailFrom || undefined,
    contactEmail: parsed.data.contactEmail || undefined,
    contactPhone: parsed.data.contactPhone || undefined,
    isActive: parsed.data.isActive,
    notes: parsed.data.notes || undefined,
  };

  try {
    if (parsed.data.id) {
      await updateMcoSupplier(parsed.data.id, input, user.id);
    } else {
      await createMcoSupplier(input, user.id);
    }
  } catch (error) {
    log.error({ err: error }, "Failed to save MCO supplier");
    return { error: "The MCO supplier could not be saved. A name must be unique." };
  }

  revalidatePath("/admin/mco-suppliers");
  return { success: parsed.data.id ? "MCO supplier updated." : "MCO supplier added." };
}

// --- Toll-free numbers ------------------------------------------------------

const tfnSchema = z.object({
  id: z.string().trim().optional(),
  number: z.string().trim().min(1, "Enter a number.").max(40),
  label: z.string().trim().min(1, "Enter a label.").max(120),
  category: z.string().trim().max(60).optional(),
  isActive: z.coerce.boolean().default(true),
  notes: z.string().trim().max(2_000).optional(),
});

export async function saveTfnAction(
  _previous: ReferenceFormState,
  formData: FormData,
): Promise<ReferenceFormState> {
  const user = await requirePermission(PERMISSIONS.TFN_MANAGE);

  const parsed = tfnSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  const input = {
    number: parsed.data.number,
    label: parsed.data.label,
    category: parsed.data.category || undefined,
    isActive: parsed.data.isActive,
    notes: parsed.data.notes || undefined,
  };

  try {
    if (parsed.data.id) {
      await updateTfn(parsed.data.id, input, user.id);
    } else {
      await createTfn(input, user.id);
    }
  } catch (error) {
    log.error({ err: error }, "Failed to save TFN");
    return { error: "The number could not be saved. It must be unique." };
  }

  revalidatePath("/admin/tfn");
  return { success: parsed.data.id ? "Number updated." : "Number added." };
}

// --- Booking types ----------------------------------------------------------

const bookingTypeSchema = z.object({
  id: z.string().trim().optional(),
  code: z.string().trim().min(1, "Enter a code.").max(40),
  label: z.string().trim().min(1, "Enter a label.").max(80),
  isActive: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9_999).default(0),
});

export async function saveBookingTypeAction(
  _previous: ReferenceFormState,
  formData: FormData,
): Promise<ReferenceFormState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_TYPE_MANAGE);

  const parsed = bookingTypeSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await upsertBookingType(
      {
        code: parsed.data.code,
        label: parsed.data.label,
        isActive: parsed.data.isActive,
        sortOrder: parsed.data.sortOrder,
      },
      user.id,
      parsed.data.id || undefined,
    );
  } catch (error) {
    log.error({ err: error }, "Failed to save booking type");
    return { error: "The booking type could not be saved. A code must be unique." };
  }

  revalidatePath("/admin/settings");
  return { success: parsed.data.id ? "Booking type updated." : "Booking type added." };
}
