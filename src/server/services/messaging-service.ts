import "server-only";

import { AuditAction, MessageStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { toStringList } from "@/lib/db/json-list";
import { prisma } from "@/lib/db/prisma";
import {
  paginate,
  toPageRequest,
  type Paginated,
  type PaginationInput,
} from "@/lib/pagination";

/**
 * Internal messaging (PMB).
 *
 * The plan is explicit: a message must not be labelled delivered merely because
 * the row was written. These are internal messages between administrators, so
 * "delivered" has a precise and achievable meaning here — the recipient row
 * exists and the message is readable in their inbox. That is SENT.
 *
 * What this module does NOT do is send email or SMS. No provider is configured.
 * Any outbound notification is recorded in `Notification` as PENDING and stays
 * there until something actually transmits it and reports back.
 */

export interface ComposeMessageInput {
  subject: string;
  body: string;
  recipientIds: string[];
  groupId?: string | undefined;
  bookingId?: string | undefined;
  /** False saves a draft; true makes it readable by its recipients. */
  send: boolean;
}

export class NoRecipientsError extends Error {
  constructor() {
    super("Choose at least one recipient, or a group that has members.");
    this.name = "NoRecipientsError";
  }
}

export async function composeMessage(
  input: ComposeMessageInput,
  actorId: string,
): Promise<{ id: string; recipientCount: number }> {
  return prisma.$transaction(async (tx) => {
    // A group expands to its members at send time, so delivery state stays
    // per-recipient rather than per-group.
    let recipientIds = [...new Set(input.recipientIds)];

    if (input.groupId) {
      const group = await tx.messageGroup.findUnique({
        where: { id: input.groupId },
        select: { memberIds: true },
      });

      if (group) {
        recipientIds = [
          ...new Set([...recipientIds, ...toStringList(group.memberIds)]),
        ];
      }
    }

    // Only real, active accounts: a stale group member must not create a
    // recipient row pointing at a deleted user.
    const validRecipients = await tx.adminUser.findMany({
      where: { id: { in: recipientIds }, status: "ACTIVE" },
      select: { id: true },
    });

    if (input.send && validRecipients.length === 0) {
      throw new NoRecipientsError();
    }

    const message = await tx.message.create({
      data: {
        subject: input.subject.trim(),
        body: input.body.trim(),
        senderId: actorId,
        groupId: input.groupId ?? null,
        bookingId: input.bookingId ?? null,
        // SENT means readable by the recipients, which is true the moment the
        // recipient rows commit. A draft has no recipients and stays DRAFT.
        status: input.send ? MessageStatus.SENT : MessageStatus.DRAFT,
        sentAt: input.send ? new Date() : null,
        recipients: input.send
          ? {
              create: validRecipients.map((recipient) => ({
                recipientId: recipient.id,
              })),
            }
          : undefined,
      },
      select: { id: true },
    });

    await recordAudit(
      {
        action: AuditAction.CREATE,
        entityType: "Message",
        entityId: message.id,
        adminUserId: actorId,
        summary: input.send
          ? `Sent internal message to ${validRecipients.length} recipient(s)`
          : "Saved message draft",
      },
      tx,
    );

    return { id: message.id, recipientCount: validRecipients.length };
  });
}

export async function markMessageRead(
  messageId: string,
  recipientId: string,
): Promise<void> {
  await prisma.messageRecipient.updateMany({
    where: { messageId, recipientId, readAt: null },
    data: { readAt: new Date() },
  });
}

export interface InboxFilters {
  q?: string | undefined;
  unreadOnly?: boolean | undefined;
}

/** Messages addressed to the signed-in administrator. */
export async function listInbox(
  recipientId: string,
  filters: InboxFilters,
  pagination: PaginationInput,
) {
  const where: Prisma.MessageRecipientWhereInput = {
    recipientId,
    archivedAt: null,
  };

  if (filters.unreadOnly) where.readAt = null;

  if (filters.q) {
    const term = filters.q.trim();
    where.message = {
      OR: [
        { subject: { contains: term } },
        { body: { contains: term } },
      ],
    };
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total, unreadCount] = await Promise.all([
    prisma.messageRecipient.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        readAt: true,
        createdAt: true,
        message: {
          select: {
            id: true,
            subject: true,
            body: true,
            status: true,
            sentAt: true,
            sender: { select: { id: true, name: true } },
            booking: { select: { id: true, bookingNumber: true } },
          },
        },
      },
    }),
    prisma.messageRecipient.count({ where }),
    prisma.messageRecipient.count({
      where: { recipientId, archivedAt: null, readAt: null },
    }),
  ]);

  return {
    ...(paginate(rows, total, pagination) as Paginated<(typeof rows)[number]>),
    unreadCount,
  };
}

/** Messages the signed-in administrator sent. */
export async function listSent(
  senderId: string,
  filters: { q?: string | undefined },
  pagination: PaginationInput,
) {
  const where: Prisma.MessageWhereInput = { senderId };

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { subject: { contains: term } },
      { body: { contains: term } },
    ];
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        subject: true,
        body: true,
        status: true,
        sentAt: true,
        createdAt: true,
        failureReason: true,
        group: { select: { id: true, name: true } },
        booking: { select: { id: true, bookingNumber: true } },
        recipients: {
          select: {
            id: true,
            readAt: true,
            recipient: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.message.count({ where }),
  ]);

  return paginate(rows, total, pagination) as Paginated<(typeof rows)[number]>;
}

// --- Groups -----------------------------------------------------------------

export async function listMessageGroups() {
  const groups = await prisma.messageGroup.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      memberIds: true,
      isActive: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
  });

  // `memberIds` is a JSON column on MySQL, so Prisma hands back `JsonValue`.
  // Decoding here means callers keep receiving `string[]`.
  return groups.map((group) => ({
    ...group,
    memberIds: toStringList(group.memberIds),
  }));
}

export async function saveMessageGroup(
  input: {
    name: string;
    description?: string | undefined;
    memberIds: string[];
    isActive: boolean;
  },
  actorId: string,
  id?: string,
): Promise<void> {
  const data = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    memberIds: input.memberIds,
    isActive: input.isActive,
  };

  if (id) {
    await prisma.messageGroup.update({ where: { id }, data });
    await recordAudit({
      action: AuditAction.UPDATE,
      entityType: "MessageGroup",
      entityId: id,
      adminUserId: actorId,
      summary: `Updated message group ${data.name}`,
    });
    return;
  }

  const created = await prisma.messageGroup.create({ data, select: { id: true } });

  await recordAudit({
    action: AuditAction.CREATE,
    entityType: "MessageGroup",
    entityId: created.id,
    adminUserId: actorId,
    summary: `Created message group ${data.name}`,
  });
}

// --- Notifications ----------------------------------------------------------

export interface NotificationFilters {
  q?: string | undefined;
  status?: string | undefined;
  channel?: string | undefined;
}

/**
 * Outbound notification history.
 *
 * Nothing in this application transmits email or SMS, so every row is PENDING
 * unless a provider integration created it and reported back. The UI says so
 * rather than letting an empty or pending list imply messages went out.
 */
export async function listNotifications(
  filters: NotificationFilters,
  pagination: PaginationInput,
) {
  const where: Prisma.NotificationWhereInput = {};

  if (filters.status) {
    where.status = filters.status as Prisma.NotificationWhereInput["status"];
  }
  if (filters.channel) {
    where.channel = filters.channel as Prisma.NotificationWhereInput["channel"];
  }

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { eventType: { contains: term } },
      { recipient: { contains: term } },
      { template: { contains: term } },
    ];
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        eventType: true,
        channel: true,
        status: true,
        recipient: true,
        template: true,
        provider: true,
        providerReference: true,
        attemptCount: true,
        lastError: true,
        sentAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where }),
  ]);

  return paginate(rows, total, pagination) as Paginated<(typeof rows)[number]>;
}
