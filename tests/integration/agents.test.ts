import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminRole, AdminUserStatus } from "@/generated/prisma/enums";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, resolveSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  DuplicateAgentError,
  createAgent,
  getAgent,
  listAgents,
  resetAgentPassword,
  unlockAgent,
  updateAgent,
} from "@/server/services/agent-service";

/**
 * Agent management against the real database.
 *
 * The reference CRM renders every agent's password in plaintext. The cases
 * below exist to prove that cannot happen here: nothing this module returns
 * contains a password or a hash, and a provisioned password is verifiable but
 * not recoverable.
 */

const SUFFIX = Date.now();
let actorId: string;
const createdUserIds: string[] = [];

async function makeAgent(overrides: Partial<Parameters<typeof createAgent>[0]> = {}) {
  const created = await createAgent(
    {
      name: "Test Agent",
      email: `agent-${SUFFIX}-${createdUserIds.length}@example.invalid`,
      role: AdminRole.OPERATIONS,
      ...overrides,
    },
    actorId,
  );

  createdUserIds.push(created.adminUserId);
  return created;
}

beforeAll(async () => {
  const actor = await prisma.adminUser.create({
    data: {
      email: `agent-actor-${SUFFIX}@example.invalid`,
      name: "Agent Test Actor",
      passwordHash: await hashPassword("irrelevant-for-these-tests"),
      role: AdminRole.SUPER_ADMIN,
    },
    select: { id: true },
  });
  actorId = actor.id;
});

afterAll(async () => {
  const all = [...createdUserIds, actorId];
  await prisma.auditLog.deleteMany({ where: { adminUserId: { in: all } } });
  await prisma.loginEvent.deleteMany({ where: { adminUserId: { in: all } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: all } } });
  await prisma.$disconnect();
});

describe("provisioning", () => {
  it("creates an agent with a profile attached to one account", async () => {
    const created = await makeAgent({ dialerId: `D${SUFFIX}`, team: "Night shift" });

    const agent = await getAgent(created.agentId);

    expect(agent).not.toBeNull();
    expect(agent?.dialerId).toBe(`D${SUFFIX}`);
    expect(agent?.team).toBe("Night shift");
    expect(agent?.adminUser.role).toBe(AdminRole.OPERATIONS);
  });

  it("issues a strong one-time password that actually works", async () => {
    const created = await makeAgent();

    expect(created.oneTimePassword.length).toBeGreaterThanOrEqual(20);

    const user = await prisma.adminUser.findUniqueOrThrow({
      where: { id: created.adminUserId },
      select: { passwordHash: true },
    });

    // Verifiable against the stored digest…
    expect(await verifyPassword(created.oneTimePassword, user.passwordHash)).toBe(true);
    // …but the digest is a bcrypt hash, not the password itself.
    expect(user.passwordHash).not.toBe(created.oneTimePassword);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it("never returns a password or hash from any read path", async () => {
    const created = await makeAgent();

    const agent = await getAgent(created.agentId);
    const list = await listAgents({}, { page: 1, pageSize: 100 });

    // Serialise everything a page could render and search it.
    const serialised = JSON.stringify({ agent, rows: list.rows });

    expect(serialised).not.toContain("passwordHash");
    expect(serialised).not.toContain(created.oneTimePassword);
    expect(serialised).not.toContain("$2b$");
    expect(serialised).not.toContain("$2a$");
  });

  it("forces the agent to choose their own password at first sign-in", async () => {
    const created = await makeAgent();

    const user = await prisma.adminUser.findUniqueOrThrow({
      where: { id: created.adminUserId },
      select: { mustChangePassword: true },
    });

    expect(user.mustChangePassword).toBe(true);
  });

  it("does not put the password in the audit trail", async () => {
    const created = await makeAgent();

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Agent", entityId: created.agentId },
    });

    expect(entry.summary).not.toContain(created.oneTimePassword);
    expect(JSON.stringify(entry)).not.toContain(created.oneTimePassword);
  });

  it("refuses a duplicate email", async () => {
    const email = `dupe-agent-${SUFFIX}@example.invalid`;
    await makeAgent({ email });

    await expect(
      createAgent({ name: "Second", email, role: AdminRole.SUPPORT }, actorId),
    ).rejects.toBeInstanceOf(DuplicateAgentError);
  });

  it("refuses a duplicate dialer id", async () => {
    const dialerId = `DIAL${SUFFIX}`;
    await makeAgent({ dialerId });

    await expect(
      createAgent(
        {
          name: "Second",
          email: `other-dial-${SUFFIX}@example.invalid`,
          role: AdminRole.SUPPORT,
          dialerId,
        },
        actorId,
      ),
    ).rejects.toBeInstanceOf(DuplicateAgentError);
  });
});

describe("password reset", () => {
  it("issues a different password and invalidates the old one", async () => {
    const created = await makeAgent();
    const replacement = await resetAgentPassword(created.agentId, actorId);

    expect(replacement).not.toBe(created.oneTimePassword);

    const user = await prisma.adminUser.findUniqueOrThrow({
      where: { id: created.adminUserId },
      select: { passwordHash: true, mustChangePassword: true },
    });

    expect(await verifyPassword(replacement, user.passwordHash)).toBe(true);
    // The old password must stop working immediately.
    expect(await verifyPassword(created.oneTimePassword, user.passwordHash)).toBe(false);
    expect(user.mustChangePassword).toBe(true);
  });

  it("revokes every live session", async () => {
    const created = await makeAgent();

    const session = await createSession(created.adminUserId);
    expect(await resolveSession(session.token)).not.toBeNull();

    await resetAgentPassword(created.agentId, actorId);

    // A stolen session must not survive a password reset.
    expect(await resolveSession(session.token)).toBeNull();
  });
});

describe("suspension", () => {
  it("revokes sessions immediately when an account is suspended", async () => {
    const created = await makeAgent();
    const session = await createSession(created.adminUserId);

    await updateAgent(
      created.agentId,
      {
        name: "Test Agent",
        role: AdminRole.OPERATIONS,
        status: AdminUserStatus.SUSPENDED,
        isActive: false,
        allowedIpRanges: [],
      },
      actorId,
    );

    expect(await resolveSession(session.token)).toBeNull();
  });

  it("records the status change in the audit trail", async () => {
    const created = await makeAgent();

    await updateAgent(
      created.agentId,
      {
        name: "Renamed Agent",
        role: AdminRole.FINANCE,
        status: AdminUserStatus.ACTIVE,
        isActive: true,
        allowedIpRanges: [],
      },
      actorId,
    );

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "Agent", entityId: created.agentId, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });

    const changes = entry?.changes as Record<string, unknown> | null;
    expect(changes).toHaveProperty("name");
    expect(changes).toHaveProperty("role");
  });
});

describe("lockout", () => {
  it("clears a lockout without touching the password", async () => {
    const created = await makeAgent();

    await prisma.adminUser.update({
      where: { id: created.adminUserId },
      data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 900_000) },
    });

    await unlockAgent(created.agentId, actorId);

    const user = await prisma.adminUser.findUniqueOrThrow({
      where: { id: created.adminUserId },
      select: { failedLoginAttempts: true, lockedUntil: true, passwordHash: true },
    });

    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
    // Unlocking is not a reset — the original password still works.
    expect(await verifyPassword(created.oneTimePassword, user.passwordHash)).toBe(true);
  });
});

describe("listAgents", () => {
  it("filters by role and status together", async () => {
    const financeAgent = await makeAgent({
      email: `finance-${SUFFIX}@example.invalid`,
      role: AdminRole.FINANCE,
    });

    const result = await listAgents(
      { role: AdminRole.FINANCE, status: AdminUserStatus.ACTIVE },
      { page: 1, pageSize: 100 },
    );

    expect(result.rows.map((row) => row.adminUser.id)).toContain(
      financeAgent.adminUserId,
    );
    expect(
      result.rows.every(
        (row) =>
          row.adminUser.role === AdminRole.FINANCE &&
          row.adminUser.status === AdminUserStatus.ACTIVE,
      ),
    ).toBe(true);
  });

  it("finds an agent by dialer id", async () => {
    const dialerId = `FIND${SUFFIX}`;
    const created = await makeAgent({
      email: `finddial-${SUFFIX}@example.invalid`,
      dialerId,
    });

    const result = await listAgents({ q: dialerId }, { page: 1, pageSize: 25 });

    expect(result.rows.map((row) => row.id)).toContain(created.agentId);
  });
});
