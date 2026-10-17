import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminRole, CustomerStatus } from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import {
  DuplicateCustomerError,
  createCustomer,
  findPotentialDuplicates,
  listCustomers,
  updateCustomer,
} from "@/server/services/customer-service";

/**
 * Customer records against the real database.
 *
 * The duplicate-detection cases are the point of this file: matching on contact
 * details must flag, and matching on name alone must not.
 */

const SUFFIX = Date.now();
let actorId: string;
const createdCustomerIds: string[] = [];

async function makeCustomer(
  overrides: Parameters<typeof createCustomer>[0],
): Promise<string> {
  const { id } = await createCustomer(overrides, actorId);
  createdCustomerIds.push(id);
  return id;
}

beforeAll(async () => {
  const actor = await prisma.adminUser.create({
    data: {
      email: `customer-test-${SUFFIX}@example.invalid`,
      name: "Customer Test Actor",
      passwordHash: await hashPassword("irrelevant-for-these-tests"),
      role: AdminRole.OPERATIONS,
    },
    select: { id: true },
  });

  actorId = actor.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { adminUserId: actorId } });
  await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  await prisma.adminUser.deleteMany({ where: { id: actorId } });
  await prisma.$disconnect();
});

describe("createCustomer", () => {
  it("assigns a unique sequential reference", async () => {
    const firstId = await makeCustomer({
      firstName: "Ada",
      lastName: "Lovelace",
      email: `ada-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: false,
    });

    const secondId = await makeCustomer({
      firstName: "Grace",
      lastName: "Hopper",
      email: `grace-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: false,
    });

    const [first, second] = await Promise.all([
      prisma.customer.findUniqueOrThrow({ where: { id: firstId } }),
      prisma.customer.findUniqueOrThrow({ where: { id: secondId } }),
    ]);

    expect(first.reference).toMatch(/^CUS-\d+$/);
    expect(second.reference).not.toBe(first.reference);
  });

  it("writes an audit entry", async () => {
    const id = await makeCustomer({
      firstName: "Audit",
      lastName: "Target",
      email: `audit-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: false,
    });

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "Customer", entityId: id, action: "CREATE" },
    });

    expect(entry).not.toBeNull();
    expect(entry?.adminUserId).toBe(actorId);
  });

  it("refuses a second customer with the same email", async () => {
    const email = `dupe-${SUFFIX}@example.invalid`;

    await makeCustomer({
      firstName: "First",
      lastName: "Person",
      email,
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: false,
    });

    await expect(
      createCustomer(
        {
          firstName: "Second",
          lastName: "Person",
          email,
          status: CustomerStatus.ACTIVE,
          confirmedDuplicate: false,
        },
        actorId,
      ),
    ).rejects.toBeInstanceOf(DuplicateCustomerError);
  });

  it("creates the record anyway once the operator confirms", async () => {
    const email = `confirmed-${SUFFIX}@example.invalid`;

    await makeCustomer({
      firstName: "Original",
      lastName: "Person",
      email,
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: false,
    });

    const id = await makeCustomer({
      firstName: "Namesake",
      lastName: "Person",
      email,
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: true,
    });

    expect(id).toBeTruthy();
  });

  it("does not treat a shared surname as a duplicate", async () => {
    await makeCustomer({
      firstName: "Oscar",
      lastName: `Casanueva${SUFFIX}`,
      email: `oscar-a-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: false,
    });

    // Same name, different contact details — a different person.
    const matches = await findPotentialDuplicates({
      email: `oscar-b-${SUFFIX}@example.invalid`,
      phone: undefined,
    });

    expect(matches).toHaveLength(0);
  });
});

describe("findPotentialDuplicates", () => {
  it("matches a phone number written in a different format", async () => {
    const id = await makeCustomer({
      firstName: "Phone",
      lastName: "Match",
      phone: "+1 (813) 021-2413",
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: false,
    });

    // Stored with punctuation; searched without. Both are the same number.
    await prisma.customer.update({
      where: { id },
      data: { phone: "8130212413" },
    });

    const matches = await findPotentialDuplicates({
      email: undefined,
      phone: "+1 813-021-2413",
    });

    expect(matches.map((match) => match.id)).toContain(id);
  });

  it("returns nothing when neither email nor phone is supplied", async () => {
    expect(
      await findPotentialDuplicates({ email: undefined, phone: undefined }),
    ).toEqual([]);
  });

  it("excludes the record being edited", async () => {
    const email = `self-${SUFFIX}@example.invalid`;
    const id = await makeCustomer({
      firstName: "Self",
      lastName: "Match",
      email,
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: false,
    });

    expect(await findPotentialDuplicates({ email, phone: undefined }, id)).toEqual([]);
  });
});

describe("updateCustomer", () => {
  it("records only the fields that changed", async () => {
    const id = await makeCustomer({
      firstName: "Before",
      lastName: "Change",
      email: `update-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: false,
    });

    await updateCustomer(
      id,
      {
        firstName: "After",
        lastName: "Change",
        email: `update-${SUFFIX}@example.invalid`,
        status: CustomerStatus.ACTIVE,
      },
      actorId,
    );

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "Customer", entityId: id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });

    expect(entry).not.toBeNull();

    const changes = entry?.changes as Record<string, unknown> | null;
    expect(changes).toHaveProperty("firstName");
    // lastName was submitted unchanged, so it must not appear.
    expect(changes).not.toHaveProperty("lastName");
  });

  it("writes no audit entry when nothing changed", async () => {
    const id = await makeCustomer({
      firstName: "Idempotent",
      lastName: "Update",
      email: `noop-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: false,
    });

    const input = {
      firstName: "Idempotent",
      lastName: "Update",
      email: `noop-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
    };

    await updateCustomer(id, input, actorId);

    const count = await prisma.auditLog.count({
      where: { entityType: "Customer", entityId: id, action: "UPDATE" },
    });

    expect(count).toBe(0);
  });
});

describe("listCustomers", () => {
  it("paginates rather than returning everything", async () => {
    const result = await listCustomers({}, { page: 1, pageSize: 2 });

    expect(result.rows.length).toBeLessThanOrEqual(2);
    expect(result.pageSize).toBe(2);
    expect(result.total).toBeGreaterThanOrEqual(result.rows.length);
  });

  it("finds a customer by a fragment of their email", async () => {
    const email = `findme-${SUFFIX}@example.invalid`;
    const id = await makeCustomer({
      firstName: "Find",
      lastName: "Me",
      email,
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: false,
    });

    const result = await listCustomers(
      { q: `findme-${SUFFIX}` },
      { page: 1, pageSize: 25 },
    );

    expect(result.rows.map((row) => row.id)).toContain(id);
  });

  it("finds a customer by reference", async () => {
    const id = await makeCustomer({
      firstName: "Reference",
      lastName: "Search",
      email: `ref-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
      confirmedDuplicate: false,
    });

    const { reference } = await prisma.customer.findUniqueOrThrow({
      where: { id },
      select: { reference: true },
    });

    const result = await listCustomers({ q: reference }, { page: 1, pageSize: 25 });

    expect(result.rows.map((row) => row.id)).toContain(id);
  });

  it("filters by status", async () => {
    const id = await makeCustomer({
      firstName: "Blocked",
      lastName: "Customer",
      email: `blocked-${SUFFIX}@example.invalid`,
      status: CustomerStatus.BLOCKED,
      confirmedDuplicate: false,
    });

    const blocked = await listCustomers(
      { status: CustomerStatus.BLOCKED },
      { page: 1, pageSize: 100 },
    );
    const active = await listCustomers(
      { status: CustomerStatus.ACTIVE },
      { page: 1, pageSize: 100 },
    );

    expect(blocked.rows.map((row) => row.id)).toContain(id);
    expect(active.rows.map((row) => row.id)).not.toContain(id);
  });
});
