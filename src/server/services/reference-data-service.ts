import "server-only";

import {
  AuditAction,
  BookingProduct,
  type SupplierType,
} from "@/generated/prisma/enums";
import { diffFields, recordAudit } from "@/lib/audit";
import { toEnumList } from "@/lib/db/json-list";
import { prisma } from "@/lib/db/prisma";

/** Every member of the enum, for validating what a JSON column gives back. */
const BOOKING_PRODUCTS = Object.values(BookingProduct);

/**
 * Operational reference data: suppliers, MCO suppliers, TFNs and booking types.
 *
 * These share a shape — a name, an active flag, some contact detail — so they
 * share this module rather than four near-identical files.
 *
 * Creating a supplier record does NOT create a connection to an airline or
 * cruise line. Integrations are modelled separately in
 * `IntegrationConfiguration`; a row here is a directory entry and nothing more.
 */

// --- Suppliers --------------------------------------------------------------

export interface SupplierInput {
  name: string;
  type: SupplierType;
  externalId?: string | undefined;
  contactName?: string | undefined;
  contactEmail?: string | undefined;
  contactPhone?: string | undefined;
  supportedProducts: BookingProduct[];
  isActive: boolean;
  notes?: string | undefined;
}

export async function listSuppliers(includeInactive = true) {
  const suppliers = await prisma.supplier.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      externalId: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      supportedProducts: true,
      isActive: true,
      notes: true,
      createdAt: true,
      _count: { select: { bookings: true } },
    },
  });

  // `supportedProducts` is a JSON column on MySQL, so Prisma hands back
  // `JsonValue`. Decoding against the enum here keeps callers typed as
  // `BookingProduct[]`, and drops any value the enum no longer contains rather
  // than letting it reach code that cannot handle it.
  return suppliers.map((supplier) => ({
    ...supplier,
    supportedProducts: toEnumList(supplier.supportedProducts, BOOKING_PRODUCTS),
  }));
}

export async function createSupplier(
  input: SupplierInput,
  actorId: string,
): Promise<string> {
  const supplier = await prisma.supplier.create({
    data: {
      name: input.name.trim(),
      type: input.type,
      externalId: input.externalId?.trim() || null,
      contactName: input.contactName?.trim() || null,
      contactEmail: input.contactEmail?.trim().toLowerCase() || null,
      contactPhone: input.contactPhone?.trim() || null,
      supportedProducts: input.supportedProducts,
      isActive: input.isActive,
      notes: input.notes?.trim() || null,
    },
    select: { id: true },
  });

  await recordAudit({
    action: AuditAction.CREATE,
    entityType: "Supplier",
    entityId: supplier.id,
    adminUserId: actorId,
    summary: `Created supplier ${input.name}`,
  });

  return supplier.id;
}

export async function updateSupplier(
  id: string,
  input: SupplierInput,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.supplier.findUniqueOrThrow({
      where: { id },
      select: {
        name: true,
        type: true,
        externalId: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        isActive: true,
        notes: true,
      },
    });

    const after = {
      name: input.name.trim(),
      type: input.type,
      externalId: input.externalId?.trim() || null,
      contactName: input.contactName?.trim() || null,
      contactEmail: input.contactEmail?.trim().toLowerCase() || null,
      contactPhone: input.contactPhone?.trim() || null,
      isActive: input.isActive,
      notes: input.notes?.trim() || null,
    };

    const changes = diffFields(before, after);

    await tx.supplier.update({
      where: { id },
      data: { ...after, supportedProducts: input.supportedProducts },
    });

    if (Object.keys(changes).length > 0) {
      await recordAudit(
        {
          action: AuditAction.UPDATE,
          entityType: "Supplier",
          entityId: id,
          adminUserId: actorId,
          summary: `Updated supplier ${after.name}`,
          changes,
        },
        tx,
      );
    }
  });
}

// --- MCO suppliers ----------------------------------------------------------

export interface McoSupplierInput {
  name: string;
  mailFrom?: string | undefined;
  contactEmail?: string | undefined;
  contactPhone?: string | undefined;
  isActive: boolean;
  notes?: string | undefined;
}

export async function listMcoSuppliers() {
  return prisma.mcoSupplier.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      mailFrom: true,
      contactEmail: true,
      contactPhone: true,
      isActive: true,
      notes: true,
      createdAt: true,
      _count: { select: { bookings: true } },
    },
  });
}

export async function createMcoSupplier(
  input: McoSupplierInput,
  actorId: string,
): Promise<string> {
  const supplier = await prisma.mcoSupplier.create({
    data: {
      name: input.name.trim(),
      mailFrom: input.mailFrom?.trim().toLowerCase() || null,
      contactEmail: input.contactEmail?.trim().toLowerCase() || null,
      contactPhone: input.contactPhone?.trim() || null,
      isActive: input.isActive,
      notes: input.notes?.trim() || null,
    },
    select: { id: true },
  });

  await recordAudit({
    action: AuditAction.CREATE,
    entityType: "McoSupplier",
    entityId: supplier.id,
    adminUserId: actorId,
    summary: `Created MCO supplier ${input.name}`,
  });

  return supplier.id;
}

export async function updateMcoSupplier(
  id: string,
  input: McoSupplierInput,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.mcoSupplier.findUniqueOrThrow({
      where: { id },
      select: {
        name: true,
        mailFrom: true,
        contactEmail: true,
        contactPhone: true,
        isActive: true,
        notes: true,
      },
    });

    const after = {
      name: input.name.trim(),
      mailFrom: input.mailFrom?.trim().toLowerCase() || null,
      contactEmail: input.contactEmail?.trim().toLowerCase() || null,
      contactPhone: input.contactPhone?.trim() || null,
      isActive: input.isActive,
      notes: input.notes?.trim() || null,
    };

    const changes = diffFields(before, after);
    await tx.mcoSupplier.update({ where: { id }, data: after });

    if (Object.keys(changes).length > 0) {
      await recordAudit(
        {
          action: AuditAction.UPDATE,
          entityType: "McoSupplier",
          entityId: id,
          adminUserId: actorId,
          summary: `Updated MCO supplier ${after.name}`,
          changes,
        },
        tx,
      );
    }
  });
}

// --- Toll-free numbers ------------------------------------------------------

export interface TfnInput {
  number: string;
  label: string;
  category?: string | undefined;
  isActive: boolean;
  notes?: string | undefined;
}

export async function listTfns() {
  return prisma.tfn.findMany({
    orderBy: [{ isActive: "desc" }, { label: "asc" }],
    select: {
      id: true,
      number: true,
      label: true,
      category: true,
      isActive: true,
      notes: true,
      createdAt: true,
      _count: { select: { bookings: true } },
    },
  });
}

export async function createTfn(input: TfnInput, actorId: string): Promise<string> {
  const tfn = await prisma.tfn.create({
    data: {
      number: input.number.trim(),
      label: input.label.trim(),
      category: input.category?.trim() || null,
      isActive: input.isActive,
      notes: input.notes?.trim() || null,
    },
    select: { id: true },
  });

  // Routing configuration is sensitive — changing where calls land is worth a
  // trail, so every mutation here is audited.
  await recordAudit({
    action: AuditAction.CREATE,
    entityType: "Tfn",
    entityId: tfn.id,
    adminUserId: actorId,
    summary: `Added toll-free number ${input.label}`,
  });

  return tfn.id;
}

export async function updateTfn(
  id: string,
  input: TfnInput,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.tfn.findUniqueOrThrow({
      where: { id },
      select: { number: true, label: true, category: true, isActive: true, notes: true },
    });

    const after = {
      number: input.number.trim(),
      label: input.label.trim(),
      category: input.category?.trim() || null,
      isActive: input.isActive,
      notes: input.notes?.trim() || null,
    };

    const changes = diffFields(before, after);
    await tx.tfn.update({ where: { id }, data: after });

    if (Object.keys(changes).length > 0) {
      await recordAudit(
        {
          action: AuditAction.UPDATE,
          entityType: "Tfn",
          entityId: id,
          adminUserId: actorId,
          summary: `Updated toll-free number ${after.label}`,
          changes,
        },
        tx,
      );
    }
  });
}

/** TFN performance: how many bookings arrived through each number. */
export async function getTfnPerformance(from: Date, to: Date) {
  const grouped = await prisma.booking.groupBy({
    by: ["tfnId", "currency"],
    where: {
      bookedAt: { gte: from, lte: to },
      tfnId: { not: null },
      status: { not: "CANCELLED" },
    },
    _count: true,
    _sum: { totalMinor: true },
  });

  const tfnIds = [...new Set(grouped.map((row) => row.tfnId).filter(Boolean))] as string[];

  const tfns = await prisma.tfn.findMany({
    where: { id: { in: tfnIds } },
    select: { id: true, number: true, label: true },
  });

  const byId = new Map(tfns.map((tfn) => [tfn.id, tfn]));

  return tfnIds.map((id) => {
    const rows = grouped.filter((row) => row.tfnId === id);
    const tfn = byId.get(id);

    return {
      id,
      number: tfn?.number ?? "Unknown",
      label: tfn?.label ?? "Unknown",
      bookings: rows.reduce((total, row) => total + row._count, 0),
      value: rows.map((row) => ({
        currency: row.currency,
        amountMinor: row._sum.totalMinor ?? 0,
      })),
    };
  });
}

// --- Booking types ----------------------------------------------------------

export interface BookingTypeInput {
  code: string;
  label: string;
  isActive: boolean;
  sortOrder: number;
}

export async function listBookingTypes() {
  return prisma.bookingType.findMany({
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }],
    select: {
      id: true,
      code: true,
      label: true,
      isActive: true,
      sortOrder: true,
      _count: { select: { bookings: true } },
    },
  });
}

export async function upsertBookingType(
  input: BookingTypeInput,
  actorId: string,
  id?: string,
): Promise<void> {
  // The code is an identifier reports group by, so it is normalised and, once
  // created, never rewritten — renaming is done through `label`.
  const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");

  if (id) {
    await prisma.bookingType.update({
      where: { id },
      data: {
        label: input.label.trim(),
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      },
    });

    await recordAudit({
      action: AuditAction.UPDATE,
      entityType: "BookingType",
      entityId: id,
      adminUserId: actorId,
      summary: `Updated booking type ${input.label}`,
    });
    return;
  }

  const created = await prisma.bookingType.create({
    data: {
      code,
      label: input.label.trim(),
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
    select: { id: true },
  });

  await recordAudit({
    action: AuditAction.CREATE,
    entityType: "BookingType",
    entityId: created.id,
    adminUserId: actorId,
    summary: `Created booking type ${input.label}`,
  });
}

// --- Removal ----------------------------------------------------------------

/**
 * Deleting reference data, and why it is usually refused.
 *
 * Bookings point at suppliers, MCO suppliers and TFNs with `onDelete:
 * Restrict`, so the database will not let a row that is in use disappear from
 * underneath a booking's history. Rather than letting the operator press a
 * button that comes back with a foreign-key error, every delete below checks
 * first and says what is holding the record — the UI offers Deactivate in its
 * place, which removes it from the pickers while the history stays readable.
 *
 * Deactivating is the common case and the right default. An outright delete is
 * for the row created by a typo five minutes ago, which is exactly the row
 * nothing references yet.
 */

/** Thrown when something still points at the record. Carries a usable reason. */
export class ReferenceInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceInUseError";
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export async function deleteSupplier(id: string, actorId: string): Promise<void> {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    select: { name: true, _count: { select: { bookings: true } } },
  });

  // Already gone. Silence rather than an error: the operator wanted it absent
  // and it is, and a second click on a stale page should not read as a fault.
  if (!supplier) return;

  if (supplier._count.bookings > 0) {
    throw new ReferenceInUseError(
      `${supplier.name} is used by ${plural(supplier._count.bookings, "booking")} and cannot be deleted. Deactivate it instead to take it out of the pickers.`,
    );
  }

  await prisma.supplier.delete({ where: { id } });

  await recordAudit({
    action: AuditAction.DELETE,
    entityType: "Supplier",
    entityId: id,
    adminUserId: actorId,
    summary: `Deleted supplier ${supplier.name}`,
  });
}

export async function deleteMcoSupplier(
  id: string,
  actorId: string,
): Promise<void> {
  const supplier = await prisma.mcoSupplier.findUnique({
    where: { id },
    select: { name: true, _count: { select: { bookings: true } } },
  });

  if (!supplier) return;

  if (supplier._count.bookings > 0) {
    throw new ReferenceInUseError(
      `${supplier.name} is used by ${plural(supplier._count.bookings, "booking")} and cannot be deleted. Deactivate it instead to take it out of the pickers.`,
    );
  }

  await prisma.mcoSupplier.delete({ where: { id } });

  await recordAudit({
    action: AuditAction.DELETE,
    entityType: "McoSupplier",
    entityId: id,
    adminUserId: actorId,
    summary: `Deleted MCO supplier ${supplier.name}`,
  });
}

export async function deleteTfn(id: string, actorId: string): Promise<void> {
  const tfn = await prisma.tfn.findUnique({
    where: { id },
    select: {
      number: true,
      label: true,
      _count: { select: { bookings: true } },
    },
  });

  if (!tfn) return;

  if (tfn._count.bookings > 0) {
    throw new ReferenceInUseError(
      `${tfn.label} is used by ${plural(tfn._count.bookings, "booking")} and cannot be deleted. Deactivate it instead so it stops being offered.`,
    );
  }

  await prisma.tfn.delete({ where: { id } });

  await recordAudit({
    action: AuditAction.DELETE,
    entityType: "Tfn",
    entityId: id,
    adminUserId: actorId,
    summary: `Deleted toll-free number ${tfn.label} (${tfn.number})`,
  });
}

/**
 * Takes a record out of circulation without deleting it.
 *
 * The counterpart to the guards above: when bookings hold a record, this is
 * what the operator actually wanted — it stops being offered on anything new
 * and every existing reference still resolves.
 *
 * Deliberately not folded into the three `update*` functions. Those take a
 * whole input object, so flipping one flag through them would mean the caller
 * reconstructing every other field and risking a stale overwrite of a value
 * somebody changed in between.
 */
export async function setReferenceActive(
  kind: "supplier" | "mcoSupplier" | "tfn",
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  const verb = isActive ? "Reactivated" : "Deactivated";

  if (kind === "supplier") {
    const row = await prisma.supplier.update({
      where: { id },
      data: { isActive },
      select: { name: true },
    });

    await recordAudit({
      action: AuditAction.UPDATE,
      entityType: "Supplier",
      entityId: id,
      adminUserId: actorId,
      summary: `${verb} supplier ${row.name}`,
      changes: { isActive: { before: !isActive, after: isActive } },
    });
    return;
  }

  if (kind === "mcoSupplier") {
    const row = await prisma.mcoSupplier.update({
      where: { id },
      data: { isActive },
      select: { name: true },
    });

    await recordAudit({
      action: AuditAction.UPDATE,
      entityType: "McoSupplier",
      entityId: id,
      adminUserId: actorId,
      summary: `${verb} MCO supplier ${row.name}`,
      changes: { isActive: { before: !isActive, after: isActive } },
    });
    return;
  }

  const row = await prisma.tfn.update({
    where: { id },
    data: { isActive },
    select: { label: true, number: true },
  });

  await recordAudit({
    action: AuditAction.UPDATE,
    entityType: "Tfn",
    entityId: id,
    adminUserId: actorId,
    summary: `${verb} toll-free number ${row.label} (${row.number})`,
    changes: { isActive: { before: !isActive, after: isActive } },
  });
}
