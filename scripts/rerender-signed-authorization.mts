import "dotenv/config";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../src/generated/prisma/client.js";
import { mysqlPoolConfig } from "../src/lib/db/mysql-url.js";

/**
 * Forgets the stored signed-authorization PDF so the next download rebuilds it.
 *
 * `signature-confirmation-service` renders that document once and serves the
 * stored bytes forever after, so that the file an operator hands to a bank is
 * byte-identical to the one already in somebody's inbox. The cost is that a
 * change to the template never reaches a booking that was signed before it —
 * which is correct for evidence and a nuisance for a test booking signed five
 * minutes before the layout changed.
 *
 * This clears the key for one booking. The signature, the consent wording and
 * every observed field are untouched: they live on the BookingSignature row and
 * are what the document is rendered *from*, so the rebuilt PDF states the same
 * facts in the current layout.
 *
 * Not for a booking whose PDF has already been emailed or handed to a bank. The
 * point of the stored copy is that two renderings of one signature cannot
 * disagree, and this deliberately gives that up.
 *
 *   npx tsx --env-file=.env scripts/rerender-signed-authorization.mts MV82367
 *   npx tsx --env-file=.env scripts/rerender-signed-authorization.mts MV82367 --dry-run
 */

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  console.error("DATABASE_URL is not set. Pass --env-file=.env.");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const bookingNumber = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

if (!bookingNumber) {
  console.error(
    "Usage: rerender-signed-authorization.mts <booking number> [--dry-run]",
  );
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(
    mysqlPoolConfig(connectionString, { connectionLimit: 2 }),
  ),
});

try {
  const signatures = await prisma.bookingSignature.findMany({
    where: {
      booking: { bookingNumber },
      signedAt: { not: null },
      confirmationPdfKey: { not: null },
    },
    select: { id: true, signedAt: true, confirmationPdfKey: true },
    orderBy: { signedAt: "asc" },
  });

  if (signatures.length === 0) {
    console.log(
      `No signed authorization with a stored PDF on ${bookingNumber}. Nothing to rebuild.`,
    );
  } else {
    console.log(
      `${signatures.length} stored document${signatures.length === 1 ? "" : "s"} on ${bookingNumber}:\n`,
    );

    for (const signature of signatures) {
      console.log(`  ${signature.signedAt?.toISOString()}  ${signature.confirmationPdfKey}`);
    }

    if (dryRun) {
      console.log("\nDry run — nothing was changed.");
    } else {
      const { count } = await prisma.bookingSignature.updateMany({
        where: { id: { in: signatures.map((signature) => signature.id) } },
        // The stored object itself is left in place rather than deleted: an
        // orphan costs a few kilobytes, and a delete that races a download in
        // flight costs an operator their file.
        data: { confirmationPdfKey: null },
      });

      console.log(
        `\nCleared ${count}. The next download or resend renders the document again.`,
      );
    }
  }
} finally {
  await prisma.$disconnect();
}
