import "server-only";

import { AuditAction, type CustomerStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { diffFields, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import { nextCustomerReference } from "@/lib/db/references";
import {
  paginate,
  resolveSort,
  toPageRequest,
  type Paginated,
  type PaginationInput,
} from "@/lib/pagination";
import type {
  CreateCustomerInput,
  CustomerInput,
} from "@/features/customers/schemas";
import { CUSTOMER_SORT_FIELDS } from "@/features/customers/schemas";

/**
 * Customer records.
 *
 * Duplicate detection is deliberately conservative: a matching email or a
 * matching phone number is treated as a likely duplicate, a matching name alone
 * is not. Two unrelated travellers share a name far more often than they share
 * a mailbox, and merging them would attach one customer's bookings and
 * documents to another.
 */

export interface DuplicateMatch {
  id: string;
  reference: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  /** Which field matched, so the warning can say why. */
  matchedOn: "email" | "phone";
}

/** Reduces a phone number to its digits so formatting differences still match. */
function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Finds existing customers that the supplied details probably already describe.
 *
 * `excludeId` skips the record being edited, which would otherwise match itself.
 */
export async function findPotentialDuplicates(
  input: Pick<CustomerInput, "email" | "phone">,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const conditions: Prisma.CustomerWhereInput[] = [];

  if (input.email) {
    conditions.push({ email: { equals: input.email } });
  }

  if (input.phone) {
    const digits = normalisePhone(input.phone);
    // Compare on the last 9 digits so "+1 (813) 021-2413" and "8130212413"
    // match without a country code making them look like different people.
    if (digits.length >= 7) {
      conditions.push({ phone: { contains: digits.slice(-9) } });
    }
  }

  if (conditions.length === 0) return [];

  const candidates = await prisma.customer.findMany({
    where: {
      OR: conditions,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: {
      id: true,
      reference: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
    take: 5,
  });

  return candidates.map((candidate) => ({
    ...candidate,
    matchedOn:
      input.email && candidate.email?.toLowerCase() === input.email
        ? ("email" as const)
        : ("phone" as const),
  }));
}

export class DuplicateCustomerError extends Error {
  readonly matches: DuplicateMatch[];

  constructor(matches: DuplicateMatch[]) {
    super("A customer with these contact details already exists.");
    this.name = "DuplicateCustomerError";
    this.matches = matches;
  }
}

export async function createCustomer(
  input: CreateCustomerInput,
  actorId: string,
): Promise<{ id: string; reference: string }> {
  if (!input.confirmedDuplicate) {
    const matches = await findPotentialDuplicates(input);
    if (matches.length > 0) throw new DuplicateCustomerError(matches);
  }

  return prisma.$transaction(async (tx) => {
    const reference = await nextCustomerReference(tx);

    const customer = await tx.customer.create({
      data: {
        reference,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        status: input.status,
        billingAddressLine1: input.billingAddressLine1 ?? null,
        billingAddressLine2: input.billingAddressLine2 ?? null,
        billingCity: input.billingCity ?? null,
        billingState: input.billingState ?? null,
        billingPostalCode: input.billingPostalCode ?? null,
        billingCountry: input.billingCountry ?? null,
        preferredLanguage: input.preferredLanguage ?? null,
        notes: input.notes ?? null,
      },
      select: { id: true, reference: true },
    });

    await recordAudit(
      {
        action: AuditAction.CREATE,
        entityType: "Customer",
        entityId: customer.id,
        adminUserId: actorId,
        summary: `Created customer ${customer.reference}`,
      },
      tx,
    );

    return customer;
  });
}

export async function updateCustomer(
  id: string,
  input: CustomerInput,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.customer.findUniqueOrThrow({
      where: { id },
      select: {
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

    const after = {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      status: input.status,
      billingAddressLine1: input.billingAddressLine1 ?? null,
      billingAddressLine2: input.billingAddressLine2 ?? null,
      billingCity: input.billingCity ?? null,
      billingState: input.billingState ?? null,
      billingPostalCode: input.billingPostalCode ?? null,
      billingCountry: input.billingCountry ?? null,
      preferredLanguage: input.preferredLanguage ?? null,
      notes: input.notes ?? null,
    };

    const changes = diffFields(before, after);

    // Nothing actually changed, so there is nothing to audit.
    if (Object.keys(changes).length === 0) return;

    await tx.customer.update({ where: { id }, data: after });

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Customer",
        entityId: id,
        adminUserId: actorId,
        summary: `Updated customer ${before.reference}`,
        changes,
      },
      tx,
    );
  });
}

export interface CustomerListRow {
  id: string;
  reference: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: CustomerStatus;
  createdAt: Date;
  bookingCount: number;
}

export interface CustomerListFilters {
  q?: string | undefined;
  status?: CustomerStatus | undefined;
  sort?: string | undefined;
}

/**
 * Paginated customer search.
 *
 * Filtering and counting both run in MySQL; no page loads the full table.
 * The free-text term matches the customer's own fields and their booking
 * numbers, which is how staff actually search — from a number on a call.
 */
export async function listCustomers(
  filters: CustomerListFilters,
  pagination: PaginationInput,
): Promise<Paginated<CustomerListRow>> {
  const where: Prisma.CustomerWhereInput = {};

  if (filters.status) where.status = filters.status;

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { firstName: { contains: term } },
      { lastName: { contains: term } },
      { email: { contains: term } },
      { phone: { contains: term } },
      { reference: { contains: term } },
      { bookings: { some: { bookingNumber: { contains: term } } } },
    ];
  }

  const { field, direction } = resolveSort(
    filters.sort,
    CUSTOMER_SORT_FIELDS,
    "createdAt",
  );

  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { [field]: direction },
      skip,
      take,
      select: {
        id: true,
        reference: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        _count: { select: { bookings: true } },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  return paginate(
    rows.map(({ _count, ...row }) => ({ ...row, bookingCount: _count.bookings })),
    total,
    pagination,
  );
}

/** Full customer profile, with booking history and notes. */
export async function getCustomerProfile(id: string) {
  return prisma.customer.findUnique({
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
      createdAt: true,
      updatedAt: true,
      bookings: {
        orderBy: { bookedAt: "desc" },
        take: 50,
        select: {
          id: true,
          bookingNumber: true,
          product: true,
          status: true,
          ticketStatus: true,
          totalMinor: true,
          currency: true,
          bookedAt: true,
        },
      },
      customerNotes: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { id: true, name: true } },
        },
      },
      _count: { select: { bookings: true, serviceCases: true, documents: true } },
    },
  });
}
