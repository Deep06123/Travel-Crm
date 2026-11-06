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
  deleteMcoSupplier,
  deleteSupplier,
  deleteTfn,
  ReferenceInUseError,
  setReferenceActive,
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

/**
 * A select or checkbox value, read as the boolean it means.
 *
 * `z.coerce.boolean()` cannot do this: it is `Boolean(value)`, and the string
 * "false" is truthy — so an Active dropdown set to No silently saved as Yes.
 * Only the literal strings a form actually posts are treated as true; an
 * absent checkbox arrives as `undefined` and falls to the default.
 */
const formBoolean = (fallback: boolean) =>
  z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") return fallback;
      if (typeof value === "boolean") return value;
      return value === "true" || value === "on" || value === "1";
    });

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
  supportsFlight: formBoolean(false),
  supportsCruise: formBoolean(false),
  isActive: formBoolean(true),
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
  isActive: formBoolean(true),
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
  isActive: formBoolean(true),
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
  isActive: formBoolean(true),
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

// --- Removal ----------------------------------------------------------------

/**
 * One action for all three, keyed by what is being removed.
 *
 * Three near-identical actions would differ only in which service function and
 * which permission they name, and a copy-pasted permission check is exactly the
 * one that eventually gets the wrong constant.
 *
 * `ReferenceInUseError` is reported as written rather than flattened into a
 * generic failure: it already explains which bookings are holding the record
 * and what to do instead, which is the whole reason it exists.
 */
const KINDS = {
  supplier: {
    permission: PERMISSIONS.SUPPLIER_MANAGE,
    remove: deleteSupplier,
    path: "/admin/suppliers",
    noun: "Supplier",
  },
  mcoSupplier: {
    permission: PERMISSIONS.SUPPLIER_MANAGE,
    remove: deleteMcoSupplier,
    path: "/admin/mco-suppliers",
    noun: "MCO supplier",
  },
  tfn: {
    permission: PERMISSIONS.TFN_MANAGE,
    remove: deleteTfn,
    path: "/admin/tfn",
    noun: "Number",
  },
} as const;

type ReferenceKind = keyof typeof KINDS;

function isKind(value: string): value is ReferenceKind {
  return value in KINDS;
}

export async function deleteReferenceAction(
  _previous: ReferenceFormState,
  formData: FormData,
): Promise<ReferenceFormState> {
  const kind = String(formData.get("kind") ?? "");
  const id = String(formData.get("id") ?? "").trim();

  if (!isKind(kind) || id === "") return { error: "Invalid request." };

  const { permission, remove, path, noun } = KINDS[kind];
  const user = await requirePermission(permission);

  // The same control, because they occupy the same slot in the row: which one
  // it is depends on whether anything references the record, and the UI
  // already knows that from the count it renders.
  const deactivating = formData.get("deactivate") === "true";

  try {
    if (deactivating) {
      await setReferenceActive(kind, id, false, user.id);
      revalidatePath(path);
      return { success: `${noun} deactivated. It no longer appears in pickers.` };
    }

    await remove(id, user.id);
  } catch (error) {
    if (error instanceof ReferenceInUseError) {
      return { error: error.message };
    }

    log.error({ err: error, kind, id }, "Failed to delete reference record");
    return { error: `The ${noun.toLowerCase()} could not be deleted.` };
  }

  revalidatePath(path);
  return { success: `${noun} deleted.` };
}
