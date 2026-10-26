import "dotenv/config";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../src/generated/prisma/client.js";
import { mysqlPoolConfig } from "../src/lib/db/mysql-url.js";
import { seedSampleDataset } from "../src/lib/db/sample-dataset.js";

/**
 * Fills the database with a sample agency, so the application can be looked at
 * with something in it.
 *
 * Every row this writes has an id beginning `demo`, which is what makes it
 * removable again: `npm run db:sample:clear` deletes exactly these and nothing
 * an operator typed in.
 *
 * Usage:
 *   npm run db:sample            # refuses if real records already exist
 *   npm run db:sample -- --force # seed anyway, alongside real data
 *
 * This is fictional data. The staff it creates are real AdminUser rows holding
 * SUPER_ADMIN and FINANCE roles — none can be signed into, because their
 * stored digest is a value no password can produce — but they will appear in
 * the agent list, in assignment pickers and in reports. That is the point when
 * you are evaluating the application, and wrong once it serves customers.
 */

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  console.error("DATABASE_URL is not set. Run via npm so .env is loaded.");
  process.exit(1);
}

const force = process.argv.includes("--force");

/** Every fixture id starts with this, which is what makes them removable. */
const demoPrefix = { startsWith: "demo" };

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(
    mysqlPoolConfig(connectionString, { connectionLimit: 2 }),
  ),
});

try {
  // The guard that keeps fictional bookings out of a real database.
  //
  // Counted by id prefix rather than by total, so re-running after a previous
  // sample seed is fine while a single genuine booking stops it. A booking is
  // the right thing to look at: reference data and an administrator exist in
  // every installation, but a booking only exists because someone made it.
  const realBookings = await prisma.booking.count({
    where: { NOT: { id: { startsWith: "demo" } } },
  });

  if (realBookings > 0 && !force) {
    console.error(
      `\nRefusing to seed: this database holds ${realBookings} booking(s) that are not sample data.\n\n` +
        "  Sample data mixes fictional staff, customers and payments into your\n" +
        "  reports and lists. If that is genuinely what you want:\n\n" +
        "      npm run db:sample -- --force\n",
    );
    process.exit(1);
  }

  // The sample mail and message groups are addressed to a real administrator,
  // so the inbox belongs to whoever actually signs in. The earliest account is
  // the one the seed provisioned.
  const owner = await prisma.adminUser.findFirst({
    where: { id: { not: { startsWith: "demo" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });

  if (!owner) {
    console.error(
      "\nNo administrator exists yet. Run `npm run db:seed` first — the sample\n" +
        "mail has to be addressed to a real account.\n",
    );
    process.exit(1);
  }

  console.log(`Seeding sample data (mail addressed to ${owner.email})…\n`);

  const summary = await seedSampleDataset(prisma, new Date(), owner.id);

  for (const [name, count] of Object.entries(summary)) {
    console.log(`  ✓ ${String(count).padStart(4)} ${name}`);
  }

  // Counts what actually landed, rather than trusting the summary.
  //
  // Prisma compiles `skipDuplicates` to MySQL's `INSERT IGNORE`, which treats
  // a foreign-key violation as a warning and drops the row. A fixture whose
  // parent is missing therefore disappears with no error at all, and the
  // summary above — computed from the input, not the result — still reports
  // success. That is precisely how this seed first went wrong: five of
  // eighteen bookings were never written, and nothing said so.
  const [bookings, customers, documents] = await Promise.all([
    prisma.booking.count({ where: { id: demoPrefix } }),
    prisma.customer.count({ where: { id: demoPrefix } }),
    prisma.document.count({ where: { id: demoPrefix } }),
  ]);

  const shortfalls = [
    ["bookings", summary.bookings, bookings],
    ["customers", summary.customers, customers],
    ["documents", summary.documents, documents],
  ].filter(([, expected, actual]) => expected !== actual);

  if (shortfalls.length > 0) {
    console.error("\nSome rows were silently dropped by the database:\n");
    for (const [name, expected, actual] of shortfalls) {
      console.error(`  ${name}: expected ${expected}, found ${actual}`);
    }
    console.error(
      "\nThis almost always means a fixture referenced a parent row that does\n" +
        "not exist. Run `npm run db:sample:clear` and investigate before\n" +
        "trusting anything on screen.\n",
    );
    process.exit(1);
  }

  console.log("\nSample data written and verified. Remove it again with:");
  console.log("  npm run db:sample:clear");
} finally {
  await prisma.$disconnect();
}
