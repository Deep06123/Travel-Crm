import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import {
  ADMIN_NOTIFICATION_SETTING_KEY,
  AdminNotificationValidationError,
  loadAdminNotificationEmails,
  MAX_ADMIN_NOTIFICATION_EMAILS,
  parseAddressList,
  saveAdminNotificationEmails,
} from "@/server/services/admin-notification-service";

import {
  restoreMailAccounts,
  suspendMailAccounts,
  type SuspendedAccounts,
} from "../helpers/mail-accounts";
import {
  restoreAdminNoticeSetting,
  takeAdminNoticeSetting,
  type SavedNoticeSetting,
} from "../helpers/admin-notices";

/**
 * The setting behind the internal notices: who is copied, and what happens to
 * what an administrator types into the box.
 *
 * Run against the real database rather than a stub because the behaviour worth
 * proving is about rows — that an empty box deletes the row rather than
 * storing an empty list, that every change leaves an audit entry, and that a
 * row holding something unexpected is read as "nobody configured" instead of
 * emailing a garbage address.
 */

const SUFFIX = Date.now();

let actorId: string;
let savedNotices: SavedNoticeSetting = null;
let suspendedAccounts: SuspendedAccounts = [];

beforeAll(async () => {
  savedNotices = await takeAdminNoticeSetting();

  // And likewise any sending account configured in Settings: `resolveMailer`
  // prefers one over the SMTP_* variables set above, which would send this
  // file's assertions through somebody else's mailbox.
  suspendedAccounts = await suspendMailAccounts();

  const actor = await prisma.adminUser.create({
    data: {
      email: `notify-test-${SUFFIX}@example.invalid`,
      name: "Notification Test Actor",
      passwordHash: await hashPassword("irrelevant-for-these-tests"),
      // The role that actually holds `settings.manage`, so the fixture matches
      // who can reach this in the application.
      role: AdminRole.SUPER_ADMIN,
    },
    select: { id: true },
  });
  actorId = actor.id;
});

afterEach(async () => {
  await prisma.businessSetting.deleteMany({
    where: { key: ADMIN_NOTIFICATION_SETTING_KEY },
  });
  await prisma.auditLog.deleteMany({ where: { adminUserId: actorId } });
});

afterAll(async () => {
  await restoreAdminNoticeSetting(savedNotices);
  await restoreMailAccounts(suspendedAccounts);
  await prisma.auditLog.deleteMany({ where: { adminUserId: actorId } });
  await prisma.adminUser.deleteMany({ where: { id: actorId } });
  await prisma.$disconnect();
});

describe("parsing what an administrator typed", () => {
  it("accepts commas, newlines and semicolons alike", () => {
    expect(
      parseAddressList("one@example.com, two@example.com\nthree@example.com;four@example.com"),
    ).toEqual([
      "one@example.com",
      "two@example.com",
      "three@example.com",
      "four@example.com",
    ]);
  });

  it("drops blanks and repeats, ignoring case on the comparison", () => {
    expect(
      parseAddressList("  owner@example.com ,, OWNER@example.com \n\n owner@example.com"),
    ).toEqual(["owner@example.com"]);
  });

  it("returns nothing for an empty box", () => {
    expect(parseAddressList("   \n  ")).toEqual([]);
  });
});

describe("saving the addresses", () => {
  it("stores the parsed list and audits the change", async () => {
    const stored = await saveAdminNotificationEmails(
      "owner@example.com\nOWNER@example.com, desk@example.com",
      actorId,
    );

    expect(stored).toEqual(["owner@example.com", "desk@example.com"]);
    await expect(loadAdminNotificationEmails()).resolves.toEqual(stored);

    const audit = await prisma.auditLog.findFirst({
      where: {
        adminUserId: actorId,
        entityType: "BusinessSetting",
        entityId: ADMIN_NOTIFICATION_SETTING_KEY,
      },
      select: { summary: true, changes: true },
    });

    // These addresses receive booking detail, so who pointed them there is
    // part of the answer when somebody later asks why.
    expect(audit?.summary).toContain("owner@example.com");
    expect(audit?.changes).toMatchObject({
      addresses: { before: [], after: ["owner@example.com", "desk@example.com"] },
    });
  });

  it("deletes the row when the box is emptied, rather than storing nothing", async () => {
    await saveAdminNotificationEmails("owner@example.com", actorId);

    const cleared = await saveAdminNotificationEmails("", actorId);
    expect(cleared).toEqual([]);

    // Absence is the off state the sender is written against; an empty list
    // left behind would be a second way to say the same thing.
    const row = await prisma.businessSetting.findUnique({
      where: { key: ADMIN_NOTIFICATION_SETTING_KEY },
    });
    expect(row).toBeNull();
  });

  it("does not audit clearing a setting that was never configured", async () => {
    await saveAdminNotificationEmails("", actorId);

    const entries = await prisma.auditLog.count({
      where: { adminUserId: actorId, entityType: "BusinessSetting" },
    });

    expect(entries).toBe(0);
  });

  it("refuses an address that is not one, and writes nothing", async () => {
    await expect(
      saveAdminNotificationEmails("owner@example.com, not-an-address", actorId),
    ).rejects.toThrow(AdminNotificationValidationError);

    await expect(loadAdminNotificationEmails()).resolves.toEqual([]);
  });

  it("refuses more addresses than the limit", async () => {
    const tooMany = Array.from(
      { length: MAX_ADMIN_NOTIFICATION_EMAILS + 1 },
      (_, index) => `person${index}@example.com`,
    ).join("\n");

    await expect(saveAdminNotificationEmails(tooMany, actorId)).rejects.toThrow(
      /limit is/,
    );

    await expect(loadAdminNotificationEmails()).resolves.toEqual([]);
  });
});

describe("reading a row that holds something unexpected", () => {
  it("ignores entries that are not addresses rather than emailing them", async () => {
    await prisma.businessSetting.create({
      data: {
        key: ADMIN_NOTIFICATION_SETTING_KEY,
        // A hand-edited row, or one from an older shape.
        value: ["good@example.com", 42, null, "not-an-address", "  "] as never,
      },
    });

    await expect(loadAdminNotificationEmails()).resolves.toEqual([
      "good@example.com",
    ]);
  });

  it("reads a value that is not a list as nobody configured", async () => {
    await prisma.businessSetting.create({
      data: {
        key: ADMIN_NOTIFICATION_SETTING_KEY,
        value: "owner@example.com" as never,
      },
    });

    await expect(loadAdminNotificationEmails()).resolves.toEqual([]);
  });
});
