import { prisma } from "@/lib/db/prisma";
import {
  ADMIN_NOTIFICATION_SETTING_KEY,
  flushPendingAdminNotices,
} from "@/server/services/admin-notification-service";

/**
 * Pins the internal-notification setting for a test file.
 *
 * Integration tests run against the real development database, so whatever an
 * operator has typed into Settings is live for them too: a configured address
 * turns every customer send into two messages on the wire and makes any
 * assertion about exactly what was emailed depend on a row nobody in the test
 * wrote. Each file that reads the SMTP sink therefore takes the setting at the
 * start, puts it back at the end, and sets it explicitly where a notice is the
 * thing under test.
 *
 * Deleting rather than overwriting, because absence is the "off" state the
 * service is written against — see `loadAdminNotificationEmails`.
 */

export type SavedNoticeSetting = { value: unknown; description: string | null } | null;

/** Reads the current setting and turns notifications off. */
export async function takeAdminNoticeSetting(): Promise<SavedNoticeSetting> {
  const existing = await prisma.businessSetting.findUnique({
    where: { key: ADMIN_NOTIFICATION_SETTING_KEY },
    select: { value: true, description: true },
  });

  await prisma.businessSetting.deleteMany({
    where: { key: ADMIN_NOTIFICATION_SETTING_KEY },
  });

  return existing;
}

/** Sets the addresses for one test, with no audit entry and no action. */
export async function setAdminNoticeEmails(
  addresses: readonly string[],
): Promise<void> {
  if (addresses.length === 0) {
    await prisma.businessSetting.deleteMany({
      where: { key: ADMIN_NOTIFICATION_SETTING_KEY },
    });
    return;
  }

  await prisma.businessSetting.upsert({
    where: { key: ADMIN_NOTIFICATION_SETTING_KEY },
    create: {
      key: ADMIN_NOTIFICATION_SETTING_KEY,
      value: [...addresses],
      description: "Set by an integration test.",
    },
    update: { value: [...addresses] },
  });
}

/**
 * Restores what the operator had configured.
 *
 * Flushes first: a notice dispatched by the last test is still in flight, and
 * restoring the row underneath it would have it read a different address than
 * the test that triggered it set.
 */
export async function restoreAdminNoticeSetting(
  saved: SavedNoticeSetting,
): Promise<void> {
  await flushPendingAdminNotices();

  await prisma.businessSetting.deleteMany({
    where: { key: ADMIN_NOTIFICATION_SETTING_KEY },
  });

  if (!saved) return;

  await prisma.businessSetting.create({
    data: {
      key: ADMIN_NOTIFICATION_SETTING_KEY,
      value: saved.value as never,
      description: saved.description,
    },
  });
}
