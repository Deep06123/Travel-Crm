import "dotenv/config";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../src/generated/prisma/client.js";
import { mysqlPoolConfig } from "../src/lib/db/mysql-url.js";

/**
 * Raises the MCO on bookings that carry an amount but were left at N/A.
 *
 * Neither booking form ever submitted an MCO status, so every row took the
 * schema default of `NOT_APPLICABLE` — including rows with a gross MCO of
 * several hundred, which then showed "N/A" in the MCO column. The create and
 * edit paths now derive the opening status from the amount; this does the same
 * for the rows written before they did.
 *
 * Narrow on purpose. Only `NOT_APPLICABLE → PENDING`, and only where a gross
 * MCO is actually present. A booking someone deliberately moved to SUBMITTED,
 * CONFIRMED or REJECTED has a settlement history, and this must not walk back
 * over it. A booking with no MCO amount has no MCO, and N/A is the truth.
 *
 * Idempotent: a second run matches nothing, because the first run moved every
 * row it matched out of `NOT_APPLICABLE`.
 *
 * Run with `npm run db:backfill:mco`. Pass `--dry-run` to see the count first.
 */

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  console.error("DATABASE_URL is not set. Run via npm so .env is loaded.");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(
    mysqlPoolConfig(connectionString, { connectionLimit: 2 }),
  ),
});

try {
  const where = {
    mcoStatus: "NOT_APPLICABLE",
    grossMcoMinor: { gt: 0 },
  } as const;

  const affected = await prisma.booking.findMany({
    where,
    select: {
      bookingNumber: true,
      grossMcoMinor: true,
      currency: true,
    },
    orderBy: { bookedAt: "desc" },
  });

  if (affected.length === 0) {
    console.log("No bookings are sitting at N/A with an MCO amount.");
  } else {
    console.log(
      `${affected.length} booking${affected.length === 1 ? "" : "s"} carry an MCO amount but read N/A:\n`,
    );

    for (const booking of affected) {
      const amount = (booking.grossMcoMinor / 100).toFixed(2);
      console.log(`  ${booking.bookingNumber}  ${amount} ${booking.currency}`);
    }

    if (dryRun) {
      console.log("\nDry run — nothing was changed.");
    } else {
      const { count } = await prisma.booking.updateMany({
        where,
        data: { mcoStatus: "PENDING" },
      });

      console.log(`\nMoved ${count} booking${count === 1 ? "" : "s"} to Pending.`);
    }
  }
} finally {
  await prisma.$disconnect();
}
