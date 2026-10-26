import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { createAgent, resetAgentPassword } from "@/server/services/agent-service";
import { changePassword, login } from "@/server/services/auth-service";

/**
 * The lifetime of a provisioning password.
 *
 * Readable is the easy half; erased is the half that decides whether this is a
 * hand-over note or a stored password. Every assertion below is about the
 * erasing — that it happens on first sign-in, that it happens on a password
 * change, and that a chosen password never lands in the column.
 */

const SUFFIX = Date.now();
let actorId: string;
const agentIds: string[] = [];
const adminUserIds: string[] = [];

async function makeAgent(label: string) {
  const created = await createAgent(
    {
      name: `Pending ${label}`,
      email: `pending-${label}-${SUFFIX}@example.invalid`,
      username: `pending${label}${SUFFIX}`,
      role: AdminRole.OPERATIONS,
    } as never,
    actorId,
  );

  agentIds.push(created.agentId);
  adminUserIds.push(created.adminUserId);

  return created;
}

async function pendingOf(adminUserId: string): Promise<string | null> {
  const row = await prisma.adminUser.findUniqueOrThrow({
    where: { id: adminUserId },
    select: { pendingPassword: true },
  });
  return row.pendingPassword;
}

beforeAll(async () => {
  const actor = await prisma.adminUser.create({
    data: {
      email: `pending-actor-${SUFFIX}@example.invalid`,
      name: "Pending Actor",
      passwordHash: "$2b$12$notused",
      role: AdminRole.SUPER_ADMIN,
    },
    select: { id: true },
  });
  actorId = actor.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { adminUserId: actorId } });
  await prisma.auditLog.deleteMany({ where: { adminUserId: { in: adminUserIds } } });
  await prisma.loginEvent.deleteMany({ where: { adminUserId: { in: adminUserIds } } });
  await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: [...adminUserIds, actorId] } } });
});

describe("pendingPassword", () => {
  it("is readable after creation and matches the issued password", async () => {
    const agent = await makeAgent("create");

    expect(agent.oneTimePassword).toBeTruthy();
    expect(await pendingOf(agent.adminUserId)).toBe(agent.oneTimePassword);
  });

  it("is erased the moment the holder signs in", async () => {
    const agent = await makeAgent("signin");

    const result = await login({
      identifier: `pending-signin-${SUFFIX}@example.invalid`,
      password: agent.oneTimePassword,
    });

    expect(result.ok).toBe(true);
    expect(await pendingOf(agent.adminUserId)).toBeNull();
  });

  it("survives a failed sign-in, which has not used it", async () => {
    const agent = await makeAgent("failed");

    const result = await login({
      identifier: `pending-failed-${SUFFIX}@example.invalid`,
      password: "not-the-password",
    });

    expect(result.ok).toBe(false);
    expect(await pendingOf(agent.adminUserId)).toBe(agent.oneTimePassword);
  });

  it("is erased when the password is changed, and the chosen one never lands there", async () => {
    const agent = await makeAgent("change");

    await changePassword(
      agent.adminUserId,
      agent.oneTimePassword,
      "a-chosen-password-9271",
    );

    const after = await pendingOf(agent.adminUserId);

    expect(after).toBeNull();
    expect(after).not.toBe("a-chosen-password-9271");
  });

  it("becomes readable again after a reset, with a different value", async () => {
    const agent = await makeAgent("reset");

    await login({
      identifier: `pending-reset-${SUFFIX}@example.invalid`,
      password: agent.oneTimePassword,
    });
    expect(await pendingOf(agent.adminUserId)).toBeNull();

    const issued = await resetAgentPassword(agent.agentId, actorId);

    expect(await pendingOf(agent.adminUserId)).toBe(issued);
    expect(issued).not.toBe(agent.oneTimePassword);
  });
});
