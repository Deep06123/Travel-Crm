import "server-only";

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import { loggerFor } from "@/lib/logging/logger";

const log = loggerFor("embedded-db");

/**
 * Embedded PostgreSQL.
 *
 * PGlite is a real PostgreSQL compiled to WebAssembly and run inside this
 * process, so there is no server to install, no connection string to obtain and
 * nothing to provision before the application works. Every model, query,
 * transaction and `SELECT … FOR UPDATE` behaves as it does against a hosted
 * Postgres, because it *is* Postgres — which is why none of the fifteen
 * services needed changing to support this.
 *
 * What it is not is durable. The data lives in memory and belongs to one
 * running process: it starts fresh whenever the process does, and on a
 * serverless host each instance holds its own copy, so two visitors may not see
 * the same records. That is the correct trade for a demonstration and the wrong
 * one for an agency's real bookings — point DATABASE_URL at a hosted Postgres
 * and this file is never loaded.
 */

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

declare global {
  var __crmEmbeddedDb: PGlite | undefined;
}

/**
 * Applies the committed migrations in filename order.
 *
 * The same SQL the hosted database receives, rather than a schema pushed from
 * `schema.prisma`, so the demo cannot drift into a shape production has never
 * seen. Prisma's own `_prisma_migrations` bookkeeping is not written: nothing
 * here is ever migrated incrementally, since the database is built from nothing
 * on every start.
 */
async function applyMigrations(db: PGlite): Promise<number> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    // Prisma prefixes each with a UTC timestamp, so lexical order is apply order.
    .sort();

  for (const directory of directories) {
    const sql = await readFile(
      join(MIGRATIONS_DIR, directory, "migration.sql"),
      "utf8",
    );

    // `exec` takes a whole script; `query` would accept only one statement.
    await db.exec(sql);
  }

  return directories.length;
}

/**
 * Writes the reference data the authorization layer depends on.
 *
 * Migrations create the tables empty, and an empty `RolePermission` means
 * `getPermissionsForRole` returns nothing for every role — so a demo would
 * sign in successfully and then be refused by every page it tried to open. The
 * grants are not optional furniture; without them the application does not
 * function.
 *
 * Taken from the same catalogue the real seed uses, so the demo's permissions
 * cannot drift from production's. `catalog.ts` holds only constants and imports
 * no database code, so reading it from here is not circular.
 */
async function seedReferenceData(db: PGlite): Promise<number> {
  const { PERMISSION_DEFINITIONS, DEFAULT_ROLE_PERMISSIONS } = await import(
    "@/lib/permissions/catalog"
  );

  // `gen_random_uuid()` rather than cuid: ids are opaque, and this keeps the
  // whole insert inside one statement per table.
  await db.query(
    `INSERT INTO "Permission" ("id", "key", "description", "category")
     SELECT gen_random_uuid()::text, k, d, c
     FROM unnest($1::text[], $2::text[], $3::text[]) AS t(k, d, c)`,
    [
      PERMISSION_DEFINITIONS.map((p) => p.key),
      PERMISSION_DEFINITIONS.map((p) => p.description),
      PERMISSION_DEFINITIONS.map((p) => p.category),
    ],
  );

  let grants = 0;

  for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    if (keys.length === 0) continue;

    await db.query(
      `INSERT INTO "RolePermission" ("id", "role", "permissionId")
       SELECT gen_random_uuid()::text, $1::"AdminRole", p."id"
       FROM "Permission" p
       WHERE p."key" = ANY($2::text[])`,
      [role, keys],
    );

    grants += keys.length;
  }

  // Booking types are operator-configurable vocabulary, but the booking forms
  // offer an empty dropdown without at least one.
  await db.query(
    `INSERT INTO "BookingType" ("id", "code", "label", "sortOrder", "updatedAt")
     SELECT gen_random_uuid()::text, c, l, o, NOW()
     FROM unnest($1::text[], $2::text[], $3::int[]) AS t(c, l, o)`,
    [
      ["ONE_WAY", "ROUND_TRIP", "MULTI_CITY", "CRUISE"],
      ["One way", "Round trip", "Multi-city", "Cruise"],
      [1, 2, 3, 4],
    ],
  );

  return grants;
}

/**
 * Creates the database and queues its schema.
 *
 * Returns synchronously, which it must: `prisma` is a plain exported const that
 * thirty-seven modules import and use directly, and making it a promise would
 * mean touching every one of them.
 *
 * Correctness does not depend on the caller awaiting anything. PGlite runs
 * operations one at a time in the order they are submitted, so the migrations
 * queued here are guaranteed to finish before the first query Prisma sends
 * afterwards — the query simply waits its turn.
 */
export function getEmbeddedDatabase(): PGlite {
  if (globalThis.__crmEmbeddedDb) return globalThis.__crmEmbeddedDb;

  const started = Date.now();
  const db = new PGlite();

  // Deliberately not awaited. See above: PGlite serialises, so this completes
  // before anything Prisma submits later. The result is still handled, because
  // an unhandled rejection here would otherwise surface far away as a confusing
  // "relation does not exist" on the first page load.
  void applyMigrations(db)
    .then(async (applied) => {
      const grants = await seedReferenceData(db);

      log.warn(
        { migrations: applied, grants, ms: Date.now() - started },
        "Embedded database ready — in-memory, not durable, resets with the process",
      );
    })
    .catch((error: unknown) => {
      log.error({ err: error }, "Embedded database failed to apply migrations");
    });

  globalThis.__crmEmbeddedDb = db;
  return db;
}
