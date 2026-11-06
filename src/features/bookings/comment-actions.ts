"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  AuditAction,
  BookingPriority,
  CommentVisibility,
  FollowUpStatus,
} from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";

const log = loggerFor("comment-actions");

export interface CommentState {
  error?: string;
  success?: string;
}

const commentSchema = z.object({
  bookingId: z.string().trim().min(1),
  body: z.string().trim().min(1, "Enter a comment.").max(5_000),
  category: z.string().trim().max(60).optional(),
  // An internal note and a message the customer will see are different things,
  // so the author chooses explicitly rather than the system guessing.
  visibility: z.enum(CommentVisibility).default(CommentVisibility.INTERNAL),
  followUpAt: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .refine(
      (value) => value === undefined || !Number.isNaN(Date.parse(value)),
      "Enter a valid date.",
    ),
});

export async function addBookingCommentAction(
  _previous: CommentState,
  formData: FormData,
): Promise<CommentState> {
  const user = await requirePermission(PERMISSIONS.COMMENT_CREATE);

  const parsed = commentSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid comment." };
  }

  const { bookingId, body, category, visibility, followUpAt } = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.bookingComment.create({
        data: {
          bookingId,
          body,
          category: category || null,
          visibility,
          authorId: user.id,
          followUpAt: followUpAt ? new Date(followUpAt) : null,
        },
      });

      // Mirror the soonest follow-up onto the booking so the dashboard and the
      // list can filter on it without scanning every comment.
      if (followUpAt) {
        await tx.booking.update({
          where: { id: bookingId },
          data: { followUpAt: new Date(followUpAt) },
        });
      }
    });
  } catch (error) {
    log.error({ err: error, bookingId }, "Failed to add comment");
    return { error: "The comment could not be saved. Try again." };
  }

  revalidatePath(`/admin/bookings/${bookingId}`);
  return { success: "Comment added." };
}

const followUpSchema = z.object({
  bookingId: z.string().trim().min(1),
  reason: z.string().trim().min(1, "Enter a reason.").max(500),
  priority: z.enum(BookingPriority).default(BookingPriority.NORMAL),
  assigneeId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  dueAt: z
    .string()
    .trim()
    .min(1, "Enter a due date.")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date."),
});

export async function createFollowUpAction(
  _previous: CommentState,
  formData: FormData,
): Promise<CommentState> {
  const user = await requirePermission(PERMISSIONS.FOLLOW_UP_MANAGE);

  const parsed = followUpSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid follow-up." };
  }

  const { bookingId, reason, priority, assigneeId, dueAt } = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const followUp = await tx.bookingFollowUp.create({
        data: {
          bookingId,
          reason,
          priority,
          assigneeId: assigneeId ?? null,
          createdById: user.id,
          dueAt: new Date(dueAt),
        },
        select: { id: true },
      });

      await tx.booking.update({
        where: { id: bookingId },
        data: { followUpAt: new Date(dueAt) },
      });

      await recordAudit(
        {
          action: AuditAction.CREATE,
          entityType: "BookingFollowUp",
          entityId: followUp.id,
          adminUserId: user.id,
          summary: `Follow-up created on booking ${bookingId}`,
        },
        tx,
      );
    });
  } catch (error) {
    log.error({ err: error, bookingId }, "Failed to create follow-up");
    return { error: "The follow-up could not be saved. Try again." };
  }

  revalidatePath(`/admin/bookings/${bookingId}`);
  revalidatePath("/admin");
  return { success: "Follow-up created." };
}

const resolveFollowUpSchema = z.object({
  followUpId: z.string().trim().min(1),
  bookingId: z.string().trim().min(1),
  status: z.enum(FollowUpStatus),
  resolutionNotes: z.string().trim().max(2_000).optional(),
});

export async function resolveFollowUpAction(
  _previous: CommentState,
  formData: FormData,
): Promise<CommentState> {
  const user = await requirePermission(PERMISSIONS.FOLLOW_UP_MANAGE);

  const parsed = resolveFollowUpSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const { followUpId, bookingId, status, resolutionNotes } = parsed.data;
  const isClosing =
    status === FollowUpStatus.COMPLETED || status === FollowUpStatus.CANCELLED;

  try {
    await prisma.bookingFollowUp.update({
      where: { id: followUpId },
      data: {
        status,
        resolutionNotes: resolutionNotes || null,
        lastActionAt: new Date(),
        lastActionNote: `Set to ${status} by ${user.name}`,
        completedAt: isClosing ? new Date() : null,
      },
    });
  } catch (error) {
    log.error({ err: error, followUpId }, "Failed to update follow-up");
    return { error: "The follow-up could not be updated. Try again." };
  }

  revalidatePath(`/admin/bookings/${bookingId}`);
  revalidatePath("/admin");
  return { success: "Follow-up updated." };
}

// --- Editing and removing a comment -----------------------------------------

/**
 * Who may change a comment after it is written.
 *
 * The author, because a typo in your own note is yours to fix, and anyone
 * holding `comment.manage`, which exists for the case the author has left or
 * wrote something that should not stand. Nobody else, including other agents
 * with `comment.create`: a booking's comment thread is a record of who said
 * what, and it stops being one the moment any colleague can rewrite a line.
 *
 * Both are re-checked here rather than only hidden in the UI.
 */
async function authoriseCommentChange(
  commentId: string,
): Promise<
  | {
      ok: true;
      actorId: string;
      comment: { bookingId: string; body: string; authorId: string | null };
    }
  | { ok: false; error: string }
> {
  const user = await requirePermission(PERMISSIONS.COMMENT_VIEW);

  const comment = await prisma.bookingComment.findUnique({
    where: { id: commentId },
    select: { bookingId: true, body: true, authorId: true },
  });

  if (!comment) return { ok: false, error: "That comment no longer exists." };

  if (comment.authorId === user.id) {
    return { ok: true, actorId: user.id, comment };
  }

  if (await currentUserCan(PERMISSIONS.COMMENT_MANAGE)) {
    return { ok: true, actorId: user.id, comment };
  }

  return {
    ok: false,
    error: "You can only change comments you wrote yourself.",
  };
}

const editSchema = z.object({
  commentId: z.string().trim().min(1),
  body: z.string().trim().min(1, "A comment cannot be empty.").max(5_000),
  category: z.string().trim().max(80).optional(),
  visibility: z.enum(CommentVisibility),
});

export async function updateBookingCommentAction(
  _previous: CommentState,
  formData: FormData,
): Promise<CommentState> {
  const parsed = editSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid comment." };
  }

  const { commentId, body, category, visibility } = parsed.data;

  const allowed = await authoriseCommentChange(commentId);
  if (!allowed.ok) return { error: allowed.error };

  try {
    await prisma.bookingComment.update({
      where: { id: commentId },
      data: { body, category: category || null, visibility },
    });

    await recordAudit({
      action: AuditAction.UPDATE,
      entityType: "BookingComment",
      entityId: commentId,
      adminUserId: allowed.actorId,
      summary: "Edited a booking comment",
      // The previous wording is kept, because "what did it say before" is the
      // only question anyone asks about an edited comment.
      changes: { body: { before: allowed.comment.body, after: body } },
    });
  } catch (error) {
    log.error({ err: error, commentId }, "Failed to edit comment");
    return { error: "The comment could not be saved. Try again." };
  }

  revalidatePath(`/admin/bookings/${allowed.comment.bookingId}`);
  revalidatePath("/admin/comments");
  return { success: "Comment updated." };
}

export async function deleteBookingCommentAction(
  _previous: CommentState,
  formData: FormData,
): Promise<CommentState> {
  const commentId = String(formData.get("commentId") ?? "").trim();
  if (commentId === "") return { error: "Invalid request." };

  const allowed = await authoriseCommentChange(commentId);
  if (!allowed.ok) return { error: allowed.error };

  try {
    await prisma.bookingComment.delete({ where: { id: commentId } });

    // The body goes into the audit entry rather than vanishing with the row:
    // a deleted comment leaving no trace of what it said is indistinguishable
    // from one that was never written.
    await recordAudit({
      action: AuditAction.DELETE,
      entityType: "BookingComment",
      entityId: commentId,
      adminUserId: allowed.actorId,
      summary: "Deleted a booking comment",
      changes: { body: { before: allowed.comment.body, after: null } },
    });
  } catch (error) {
    log.error({ err: error, commentId }, "Failed to delete comment");
    return { error: "The comment could not be deleted. Try again." };
  }

  revalidatePath(`/admin/bookings/${allowed.comment.bookingId}`);
  revalidatePath("/admin/comments");
  return { success: "Comment deleted." };
}
