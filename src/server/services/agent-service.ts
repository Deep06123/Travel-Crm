import "server-only";

import { randomBytes } from "node:crypto";

import {
  AdminRole,
  AdminUserStatus,
  AuditAction,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { diffFields, recordAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  paginate,
  toPageRequest,
  type Paginated,
  type PaginationInput,
} from "@/lib/pagination";

/**
 * Agents — booking-floor staff.
 *
 * The reference CRM's agent list renders a PASSWORD column in plaintext. That
 * is not reproduced and cannot be: passwords exist only as bcrypt digests on
 * AdminUser, and nothing in this module reads `passwordHash`, let alone
 * returns it. An administrator who needs to restore access issues a one-time
 * password that is shown once and never stored in recoverable form.
 *
 * An Agent row is a profile attached to an AdminUser. Authentication always
 * goes through AdminUser, so there is no second credential path.
 */

/** Fields safe to return. `passwordHash` is deliberately absent. */
const AGENT_SELECT = {
  id: true,
  dialerId: true,
  team: true,
  isActive: true,
  allowedIpRanges: true,
  createdAt: true,
  adminUser: {
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      phone: true,
      role: true,
      status: true,
      lastLoginAt: true,
      mustChangePassword: true,
      createdAt: true,
    },
  },
} satisfies Prisma.AgentSelect;

export class DuplicateAgentError extends Error {
  constructor(field: "email" | "username" | "dialerId", value: string) {
    super(`An account already uses that ${field === "dialerId" ? "dialer id" : field}: ${value}`);
    this.name = "DuplicateAgentError";
  }
}

export interface CreateAgentInput {
  name: string;
  email: string;
  username?: string | undefined;
  phone?: string | undefined;
  role: AdminRole;
  dialerId?: string | undefined;
  team?: string | undefined;
}

export interface CreatedAgent {
  agentId: string;
  adminUserId: string;
  /**
   * Shown to the administrator exactly once. Only its bcrypt digest is stored,
   * so it cannot be recovered afterwards.
   */
  oneTimePassword: string;
}

export async function createAgent(
  input: CreateAgentInput,
  actorId: string,
): Promise<CreatedAgent> {
  const email = input.email.trim().toLowerCase();
  const username = input.username?.trim().toLowerCase() || undefined;

  const [emailTaken, usernameTaken, dialerTaken] = await Promise.all([
    prisma.adminUser.findUnique({ where: { email }, select: { id: true } }),
    username
      ? prisma.adminUser.findUnique({ where: { username }, select: { id: true } })
      : null,
    input.dialerId
      ? prisma.agent.findUnique({
          where: { dialerId: input.dialerId },
          select: { id: true },
        })
      : null,
  ]);

  if (emailTaken) throw new DuplicateAgentError("email", email);
  if (usernameTaken) throw new DuplicateAgentError("username", username!);
  if (dialerTaken) throw new DuplicateAgentError("dialerId", input.dialerId!);

  // 24 random bytes, base64url — far beyond guessing, and never persisted in
  // plaintext.
  const oneTimePassword = randomBytes(18).toString("base64url");

  return prisma.$transaction(async (tx) => {
    const adminUser = await tx.adminUser.create({
      data: {
        email,
        username: username ?? null,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        passwordHash: await hashPassword(oneTimePassword),
        role: input.role,
        status: AdminUserStatus.ACTIVE,
        // The provisioning password is never the long-lived credential.
        mustChangePassword: true,
      },
      select: { id: true },
    });

    const agent = await tx.agent.create({
      data: {
        adminUserId: adminUser.id,
        dialerId: input.dialerId?.trim() || null,
        team: input.team?.trim() || null,
      },
      select: { id: true },
    });

    await recordAudit(
      {
        action: AuditAction.CREATE,
        entityType: "Agent",
        entityId: agent.id,
        adminUserId: actorId,
        // The password is not mentioned, because it is not knowable from here.
        summary: `Created agent ${input.name} (${input.role})`,
      },
      tx,
    );

    return {
      agentId: agent.id,
      adminUserId: adminUser.id,
      oneTimePassword,
    };
  });
}

export interface UpdateAgentInput {
  name: string;
  phone?: string | undefined;
  role: AdminRole;
  status: AdminUserStatus;
  dialerId?: string | undefined;
  team?: string | undefined;
  isActive: boolean;
  allowedIpRanges: string[];
}

export async function updateAgent(
  agentId: string,
  input: UpdateAgentInput,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findUniqueOrThrow({
      where: { id: agentId },
      select: {
        id: true,
        dialerId: true,
        team: true,
        isActive: true,
        allowedIpRanges: true,
        adminUser: {
          select: { id: true, name: true, phone: true, role: true, status: true },
        },
      },
    });

    const userChanges = diffFields(
      {
        name: agent.adminUser.name,
        phone: agent.adminUser.phone,
        role: agent.adminUser.role,
        status: agent.adminUser.status,
      },
      {
        name: input.name,
        phone: input.phone ?? null,
        role: input.role,
        status: input.status,
      },
    );

    const agentChanges = diffFields(
      {
        dialerId: agent.dialerId,
        team: agent.team,
        isActive: agent.isActive,
      },
      {
        dialerId: input.dialerId ?? null,
        team: input.team ?? null,
        isActive: input.isActive,
      },
    );

    await tx.adminUser.update({
      where: { id: agent.adminUser.id },
      data: {
        name: input.name,
        phone: input.phone ?? null,
        role: input.role,
        status: input.status,
      },
    });

    await tx.agent.update({
      where: { id: agentId },
      data: {
        dialerId: input.dialerId ?? null,
        team: input.team ?? null,
        isActive: input.isActive,
        allowedIpRanges: input.allowedIpRanges,
      },
    });

    const changes = { ...userChanges, ...agentChanges };

    if (Object.keys(changes).length > 0) {
      await recordAudit(
        {
          action: AuditAction.UPDATE,
          entityType: "Agent",
          entityId: agentId,
          adminUserId: actorId,
          summary: `Updated agent ${input.name}`,
          changes,
        },
        tx,
      );
    }
  });

  // Suspending or deactivating must take effect now, not at session expiry.
  if (input.status !== AdminUserStatus.ACTIVE) {
    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
      select: { adminUserId: true },
    });

    const revoked = await revokeAllSessionsForUser(agent.adminUserId);

    await recordAudit({
      action: AuditAction.UPDATE,
      entityType: "AdminUser",
      entityId: agent.adminUserId,
      adminUserId: actorId,
      summary: `Account set to ${input.status}; ${revoked} session(s) revoked`,
    });
  }
}

/**
 * Issues a new one-time password and ends every live session.
 *
 * Returns the password for a single display. There is no "view password"
 * anywhere in this application, because no plaintext password exists to view.
 */
export async function resetAgentPassword(
  agentId: string,
  actorId: string,
): Promise<string> {
  const oneTimePassword = randomBytes(18).toString("base64url");

  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: { adminUserId: true, adminUser: { select: { name: true } } },
  });

  await prisma.adminUser.update({
    where: { id: agent.adminUserId },
    data: {
      passwordHash: await hashPassword(oneTimePassword),
      passwordChangedAt: new Date(),
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  const revoked = await revokeAllSessionsForUser(agent.adminUserId);

  await recordAudit({
    action: AuditAction.UPDATE,
    entityType: "Agent",
    entityId: agentId,
    adminUserId: actorId,
    summary: `Password reset for ${agent.adminUser.name}; ${revoked} session(s) revoked`,
  });

  return oneTimePassword;
}

/** Clears a lockout without changing the password. */
export async function unlockAgent(agentId: string, actorId: string): Promise<void> {
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: { adminUserId: true, adminUser: { select: { name: true } } },
  });

  await prisma.adminUser.update({
    where: { id: agent.adminUserId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

  await recordAudit({
    action: AuditAction.UPDATE,
    entityType: "Agent",
    entityId: agentId,
    adminUserId: actorId,
    summary: `Lockout cleared for ${agent.adminUser.name}`,
  });
}

export interface AgentListFilters {
  q?: string | undefined;
  role?: AdminRole | undefined;
  status?: AdminUserStatus | undefined;
}

export async function listAgents(
  filters: AgentListFilters,
  pagination: PaginationInput,
) {
  const where: Prisma.AgentWhereInput = {};

  // Built as one object so a role filter and a status filter combine rather
  // than the second replacing the first.
  const adminUserWhere: Prisma.AdminUserWhereInput = {};
  if (filters.role) adminUserWhere.role = filters.role;
  if (filters.status) adminUserWhere.status = filters.status;

  if (Object.keys(adminUserWhere).length > 0) {
    where.adminUser = adminUserWhere;
  }

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { dialerId: { contains: term, mode: "insensitive" } },
      { team: { contains: term, mode: "insensitive" } },
      { adminUser: { name: { contains: term, mode: "insensitive" } } },
      { adminUser: { email: { contains: term, mode: "insensitive" } } },
      { adminUser: { username: { contains: term, mode: "insensitive" } } },
      { adminUser: { phone: { contains: term } } },
    ];
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.agent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: AGENT_SELECT,
    }),
    prisma.agent.count({ where }),
  ]);

  return paginate(rows, total, pagination) as Paginated<(typeof rows)[number]>;
}

export async function getAgent(agentId: string) {
  return prisma.agent.findUnique({
    where: { id: agentId },
    select: AGENT_SELECT,
  });
}

/**
 * Per-agent activity, for the performance view.
 *
 * Counts and value only. The plan is explicit that agents must not be ranked
 * on metrics that have not been validated, so nothing here produces a score or
 * an ordering by "productivity".
 */
export async function getAgentActivity(
  adminUserId: string,
  from: Date,
  to: Date,
) {
  const inRange = { bookedAt: { gte: from, lte: to } };

  const [created, assigned, ticketed, cancelled, openFollowUps, overdueFollowUps, value] =
    await Promise.all([
      prisma.booking.count({ where: { ...inRange, createdById: adminUserId } }),
      prisma.booking.count({ where: { ...inRange, assignedAgentId: adminUserId } }),
      prisma.booking.count({
        where: { ...inRange, assignedAgentId: adminUserId, status: "TICKETED" },
      }),
      prisma.booking.count({
        where: { ...inRange, assignedAgentId: adminUserId, status: "CANCELLED" },
      }),
      prisma.bookingFollowUp.count({
        where: { assigneeId: adminUserId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      }),
      prisma.bookingFollowUp.count({
        where: {
          assigneeId: adminUserId,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          dueAt: { lt: new Date() },
        },
      }),
      prisma.booking.groupBy({
        by: ["currency"],
        where: {
          ...inRange,
          assignedAgentId: adminUserId,
          status: { not: "CANCELLED" },
        },
        _sum: { totalMinor: true },
      }),
    ]);

  return {
    created,
    assigned,
    ticketed,
    cancelled,
    openFollowUps,
    overdueFollowUps,
    bookingValue: value.map((row) => ({
      currency: row.currency,
      amountMinor: row._sum.totalMinor ?? 0,
    })),
  };
}
