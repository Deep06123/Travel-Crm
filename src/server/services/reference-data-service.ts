import "server-only";

import { AuditAction, type BookingProduct, type SupplierType } from "@/generated/prisma/enums";
import { diffFields, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";

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
  return prisma.supplier.findMany({
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
