import "server-only";

import { headers } from "next/headers";

import type { AuditAction } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";

const log = loggerFor("audit");

/**
 * Audit trail.
 *
 * Entries are append-only: a mistake is corrected by writing another entry, not
 * by editing history. `changes` is filtered through `REDACTED_FIELDS` before it
 * is persisted, so the trail can record that a passport number changed without
 * recording the number itself.
 */

const REDACTED_FIELDS = new Set([
  "password",
  "passwordHash",
  "passportNumber",
  "dateOfBirth",
  "cardNumber",
  "cvv",
  "tokenHash",
  "idempotencyKey",
]);

export interface FieldChange {
  before: unknown;
  after: unknown;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: string;
  adminUserId: string | null;
  summary: string;
  changes?: Record<string, FieldChange> | undefined;
}

function redactChanges(
  changes: Record<string, FieldChange>,
): Record<string, FieldChange> {
  const result: Record<string, FieldChange> = {};

  for (const [field, change] of Object.entries(changes)) {
    result[field] = REDACTED_FIELDS.has(field)
      ? { before: "[redacted]", after: "[redacted]" }
      : change;
  }

  return result;
}

/**
 * Computes the changed fields between two versions of a record.
 *
 * Only fields that actually differ are returned, so an audit entry shows the
 * edit rather than the whole row.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};

  for (const [field, afterValue] of Object.entries(after)) {
    const beforeValue = before[field];
    if (Object.is(beforeValue, afterValue)) continue;

    // Dates and other objects need value comparison, not identity.
    if (
      beforeValue instanceof Date &&
      afterValue instanceof Date &&
      beforeValue.getTime() === afterValue.getTime()
    ) {
      continue;
    }

    changes[field] = { before: beforeValue, after: afterValue };
  }

  return changes;
}

/**
 * Converts a change map to a plain JSON object Prisma can store.
 *
 * Round-tripping through JSON drops values a Json column cannot hold — Dates
 * become ISO strings, `undefined` disappears — so the write cannot fail on a
 * value type that only surfaced at runtime.
 */
function toJsonObject(
  changes: Record<string, FieldChange>,
): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(changes)) as Prisma.InputJsonObject;
}

async function requestContext(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  try {
    const headerList = await headers();
    const forwardedFor = headerList.get("x-forwarded-for");

    return {
      ipAddress: forwardedFor?.split(",")[0]?.trim() ?? headerList.get("x-real-ip"),
      userAgent: headerList.get("user-agent"),
    };
  } catch {
    // Outside a request scope, e.g. a seed script or background job.
    return { ipAddress: null, userAgent: null };
  }
}

/**
 * Writes an audit entry.
 *
 * Pass `tx` when the audited change runs inside a transaction, so the entry
 * commits or rolls back with it and the trail cannot drift from the data.
 */
export async function recordAudit(
  entry: AuditEntry,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  const { ipAddress, userAgent } = await requestContext();

  const changes = entry.changes
    ? toJsonObject(redactChanges(entry.changes))
    : undefined;

  try {
    await client.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        adminUserId: entry.adminUserId,
        summary: entry.summary,
        changes: changes ?? undefined,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    // Inside a transaction the failure must propagate, so the audited change is
    // rolled back rather than committed untracked.
    if (tx) throw error;

    log.error(
      { err: error, action: entry.action, entityType: entry.entityType },
      "Failed to write audit entry",
    );
  }
}
