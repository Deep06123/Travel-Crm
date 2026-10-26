import "dotenv/config";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../src/generated/prisma/client.js";
import { mysqlPoolConfig } from "../src/lib/db/mysql-url.js";

/**
 * Removes everything `npm run db:sample` wrote, and nothing else.
 *
 * Every sample row carries an id beginning `demo`, so each delete below is
 * narrowed by that prefix. A booking an operator created has a cuid and is
 * never matched — which is the whole reason the fixtures use fixed ids.
 *
 * Order matters, and it is innermost-first. Financial and historical rows use
 * `onDelete: Restrict` precisely so that deleting a booking cannot silently
 * take its payment trail with it; this has to respect the same constraint real
 * code does, rather than disabling foreign key checks to get around it.
 */

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  console.error("DATABASE_URL is not set. Run via npm so .env is loaded.");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(
    mysqlPoolConfig(connectionString, { connectionLimit: 2 }),
  ),
});

const demo = { startsWith: "demo" };

try {
  const steps: [string, () => Promise<{ count: number }>][] = [
    // Message delivery before messages, evidence before chargebacks.
    ["message recipients", () => prisma.messageRecipient.deleteMany({ where: { id: demo } })],
    ["chargeback evidence", () => prisma.chargebackEvidence.deleteMany({ where: { chargebackId: demo } })],
    ["notifications", () => prisma.notification.deleteMany({ where: { id: demo } })],
    ["messages", () => prisma.message.deleteMany({ where: { id: demo } })],
    ["message groups", () => prisma.messageGroup.deleteMany({ where: { id: demo } })],

    // Money. Refunds and chargebacks reference payments, so they go first.
    ["refunds", () => prisma.refund.deleteMany({ where: { id: demo } })],
    ["chargebacks", () => prisma.chargeback.deleteMany({ where: { id: demo } })],
    ["adjustments", () => prisma.financialAdjustment.deleteMany({ where: { id: demo } })],
    ["payments", () => prisma.payment.deleteMany({ where: { id: demo } })],

    // Documents: the pointer to the current version is cleared before the
    // versions are removed, or the foreign key blocks it.
    ["document pointers", async () => prisma.document.updateMany({
      where: { id: demo },
      data: { currentVersionId: null },
    })],
    ["document versions", () => prisma.documentVersion.deleteMany({ where: { id: demo } })],
    ["documents", () => prisma.document.deleteMany({ where: { id: demo } })],

    // Operational records hanging off bookings and customers.
    ["call records", () => prisma.callRecord.deleteMany({ where: { id: demo } })],
    ["service cases", () => prisma.customerServiceCase.deleteMany({ where: { id: demo } })],
    ["follow-ups", () => prisma.bookingFollowUp.deleteMany({ where: { id: demo } })],
    ["comments", () => prisma.bookingComment.deleteMany({ where: { id: demo } })],
    ["status history", () => prisma.bookingStatusHistory.deleteMany({ where: { id: demo } })],
    ["customer notes", () => prisma.customerNote.deleteMany({ where: { id: demo } })],

    // Booking detail, then bookings, then the customers they belong to.
    ["passengers", () => prisma.passenger.deleteMany({ where: { id: demo } })],
    ["flight segments", () => prisma.flightSegment.deleteMany({ where: { id: demo } })],
    ["flight details", () => prisma.flightDetail.deleteMany({ where: { id: demo } })],
    ["cruise details", () => prisma.cruiseDetail.deleteMany({ where: { id: demo } })],
    ["bookings", () => prisma.booking.deleteMany({ where: { id: demo } })],
    ["customers", () => prisma.customer.deleteMany({ where: { id: demo } })],

    // Reference data the fixtures added. Booking types are left alone: the
    // real seed creates those too, and they are not prefixed.
    ["suppliers", () => prisma.supplier.deleteMany({ where: { id: demo } })],
    ["MCO suppliers", () => prisma.mcoSupplier.deleteMany({ where: { id: demo } })],
    ["toll-free numbers", () => prisma.tfn.deleteMany({ where: { id: demo } })],
    ["integrations", () => prisma.integrationConfiguration.deleteMany({ where: { id: demo } })],

    // The audit trail last: it records the actions above.
    ["audit entries", () => prisma.auditLog.deleteMany({ where: { id: demo } })],

    // Staff profiles, then the accounts behind them.
    ["agent profiles", () => prisma.agent.deleteMany({ where: { adminUserId: demo } })],
    ["sample staff", () => prisma.adminUser.deleteMany({ where: { id: demo } })],
  ];

  let total = 0;

  for (const [label, run] of steps) {
    const { count } = await run();
    total += count;
    if (count > 0) console.log(`  − ${String(count).padStart(4)} ${label}`);
  }

  console.log(
    total > 0
      ? `\nRemoved ${total} sample rows. Your own records were not touched.`
      : "\nNo sample data found — nothing to remove.",
  );
} finally {
  await prisma.$disconnect();
}
