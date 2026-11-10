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
import { toStringList } from "@/lib/db/json-list";
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
 * The reference CRM's agent list renders a PASSWORD column in plaintext — every
 * agent's real, chosen password, readable forever. That is not reproduced and
 * cannot be: chosen passwords exist only as bcrypt digests on AdminUser, and
 * nothing in this module reads `passwordHash`, let alone returns it.
 *
 * What is readable is narrower. `AdminUser.pendingPassword` holds the one-time
 * password an account was provisioned or reset with, so whoever issued it can
 * pass it on instead of having a single chance to copy it. It is erased the
 * moment the holder signs in, and a password they choose never lands there —
 * so the column is empty for every account in normal use.
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
      // Null for every account that has signed in, which is most of them.
      // Whether it is rendered is a separate decision, made by the page
      // against `agent.manage` — selecting it is not the same as showing it.
      pendingPassword: true,
      createdAt: true,
      // Whether the account has acted, which decides whether the list offers
      // Delete or Deactivate. Two counts rather than the seven `deleteAgent`
      // checks: audit entries cover almost everything consequential, and the
      // server re-counts properly before it removes anything.
      _count: { select: { createdBookings: true, auditLogs: true } },
    },
  },
} satisfies Prisma.AgentSelect;

/**
 * Turns the stored JSON allowlist back into a list of strings.
 *
 * `allowedIpRanges` is a JSON column on MySQL rather than the `text[]` it was
 * on Postgres, so Prisma types it as `JsonValue`. Decoding here keeps that an
 * implementation detail of this module: callers continue to receive
 * `string[]`, and a malformed row yields an empty allowlist rather than a
 * crash — which denies nothing, since an empty list means "no IP restriction"
 * and is the shape the vast majority of rows already hold.
 */
function withDecodedIpRanges<T extends { allowedIpRanges: unknown }>(
  agent: T,
): Omit<T, "allowedIpRanges"> & { allowedIpRanges: string[] } {
  return { ...agent, allowedIpRanges: toStringList(agent.allowedIpRanges) };
}

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
   * The provisioning password, also kept in `AdminUser.pendingPassword` so the
   * creator can read it back until the holder first signs in. It is erased at
   * that point, and a password the holder chooses never lands there.
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

  // 24 random bytes, base64url — far beyond guessing. Kept readable in
  // `pendingPassword` only until the holder first signs in, so whoever created
  // the account can pass it on rather than having one chance to copy it.
  const oneTimePassword = randomBytes(18).toString("base64url");

  return prisma.$transaction(async (tx) => {
    const adminUser = await tx.adminUser.create({
      data: {
        email,
        username: username ?? null,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        passwordHash: await hashPassword(oneTimePassword),
        pendingPassword: oneTimePassword,
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
        // Supplied explicitly: a MySQL JSON column cannot carry a literal
        // DEFAULT, so there is no value for an omitted field to fall back to.
        // A new agent starts with no IP restriction.
        allowedIpRanges: [],
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
      // Readable again until used: a reset exists because somebody is locked
      // out, and they have to be told the new one.
      pendingPassword: oneTimePassword,
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
      { dialerId: { contains: term } },
      { team: { contains: term } },
      { adminUser: { name: { contains: term } } },
      { adminUser: { email: { contains: term } } },
      { adminUser: { username: { contains: term } } },
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

  const agents = rows.map(withDecodedIpRanges);

  return paginate(agents, total, pagination) as Paginated<(typeof agents)[number]>;
}

export async function getAgent(agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: AGENT_SELECT,
  });

  return agent ? withDecodedIpRanges(agent) : null;
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

// --- Removal ----------------------------------------------------------------

/** Thrown when an account cannot be removed — it is gone, or it is your own. */
export class AgentInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentInUseError";
  }
}

/**
 * Deletes an agent account outright, whatever it has done.
 *
 * Every foreign key pointing at `AdminUser` is `SetNull`, so the row goes and
 * the work survives with its attribution cleared: bookings they created,
 * refunds they approved and authorizations they sent remain, but no longer
 * name anybody. `AdminSession` and `Agent` cascade, so the account's sessions
 * end with it and it cannot sign back in.
 *
 * The audit entry records what was lost — it survives the delete because
 * `AuditLog.adminUserId` is nulled rather than removed — so the trail still
 * says an account with this footprint existed and who removed it.
 *
 * The one refusal left is deleting yourself, which would sign you out
 * mid-request and leave the session pointing at a row that is no longer there.
 */
export async function deleteAgent(
  agentId: string,
  actorId: string,
): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      adminUserId: true,
      adminUser: {
        select: {
          name: true,
          email: true,
          _count: {
            select: {
              createdBookings: true,
              assignedBookings: true,
              auditLogs: true,
              paymentsRecorded: true,
              refundsApproved: true,
              signaturesSent: true,
              comments: true,
            },
          },
        },
      },
    },
  });

  if (!agent) return;

  if (agent.adminUserId === actorId) {
    throw new AgentInUseError("You cannot delete your own account.");
  }

  const { adminUser } = agent;
  const counts = adminUser._count;

  const footprint = [
    counts.createdBookings > 0 ? `${counts.createdBookings} booking(s) created` : null,
    counts.assignedBookings > 0 ? `${counts.assignedBookings} booking(s) assigned` : null,
    counts.paymentsRecorded > 0 ? `${counts.paymentsRecorded} payment(s)` : null,
    counts.refundsApproved > 0 ? `${counts.refundsApproved} refund approval(s)` : null,
    counts.signaturesSent > 0 ? `${counts.signaturesSent} authorization(s) sent` : null,
    counts.comments > 0 ? `${counts.comments} comment(s)` : null,
    counts.auditLogs > 0 ? `${counts.auditLogs} audit entries` : null,
  ].filter((part): part is string => part !== null);

  // The Agent row and every session cascade from AdminUser, so one delete
  // removes the account and ends its access in the same statement.
  await prisma.adminUser.delete({ where: { id: agent.adminUserId } });

  await recordAudit({
    action: AuditAction.DELETE,
    entityType: "AdminUser",
    entityId: agent.adminUserId,
    adminUserId: actorId,
    summary:
      footprint.length > 0
        ? `Deleted the account ${adminUser.name} <${adminUser.email}>, unattributing ${footprint.join(", ")}`
        : `Deleted the unused account ${adminUser.name} <${adminUser.email}>`,
  });
}

/**
 * Suspends or restores an account, revoking live sessions on the way out.
 *
 * The revocation is the point: sessions are database-backed precisely so
 * access ends now rather than whenever a token would have expired.
 */
export async function setAgentAccountStatus(
  agentId: string,
  status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED",
  actorId: string,
): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      adminUserId: true,
      adminUser: { select: { name: true, status: true } },
    },
  });

  if (!agent) throw new AgentInUseError("That agent no longer exists.");
  if (agent.adminUser.status === status) return;

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: agent.adminUserId },
      data: { status },
    });

    // Only on the way out. Restoring an account should not punish whoever is
    // already signed in elsewhere.
    if (status !== "ACTIVE") {
      await tx.adminSession.updateMany({
        where: { adminUserId: agent.adminUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await tx.agent.update({
      where: { id: agentId },
      data: { isActive: status === "ACTIVE" },
    });
  });

  await recordAudit({
    action: AuditAction.UPDATE,
    entityType: "AdminUser",
    entityId: agent.adminUserId,
    adminUserId: actorId,
    summary: `Set ${agent.adminUser.name}'s account to ${status.toLowerCase()}`,
    changes: { status: { before: agent.adminUser.status, after: status } },
  });
}
