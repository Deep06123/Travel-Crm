import "dotenv/config";

import { randomBytes } from "node:crypto";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../src/generated/prisma/client";
import { mysqlPoolConfig } from "../src/lib/db/mysql-url";
import { AdminRole, SupplierType } from "../src/generated/prisma/enums";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_DEFINITIONS,
} from "../src/lib/permissions/catalog";

/**
 * Seeds reference data and provisions the first administrator.
 *
 * Safe to re-run: every write is an upsert keyed on a natural unique column.
 * The initial administrator is only created when no administrator exists, so a
 * re-run never resets a live account's password.
 */

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Seeding requires a database.");
}

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(
    mysqlPoolConfig(connectionString, { connectionLimit: 2 }),
  ),
});

async function seedPermissions(): Promise<void> {
  for (const definition of PERMISSION_DEFINITIONS) {
    await prisma.permission.upsert({
      where: { key: definition.key },
      create: {
        key: definition.key,
        description: definition.description,
        category: definition.category,
      },
      update: {
        description: definition.description,
        category: definition.category,
      },
    });
  }

  console.log(`  ✓ ${PERMISSION_DEFINITIONS.length} permissions`);
}

async function seedRolePermissions(): Promise<void> {
  const permissions = await prisma.permission.findMany({
    select: { id: true, key: true },
  });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  let granted = 0;

  for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    for (const key of keys) {
      const permissionId = idByKey.get(key);
      if (!permissionId) {
        throw new Error(
          `Role ${role} references unknown permission "${key}". The catalogue and the database are out of step.`,
        );
      }

      await prisma.rolePermission.upsert({
        where: {
          role_permissionId: { role: role as AdminRole, permissionId },
        },
        create: { role: role as AdminRole, permissionId },
        update: {},
      });
      granted += 1;
    }
  }

  console.log(`  ✓ ${granted} role grants`);
}

async function seedBookingTypes(): Promise<void> {
  // Categories taken from the reference CRM's booking list.
  const types = [
    { code: "NEW_BOOKING", label: "New Booking", sortOrder: 10 },
    { code: "RE_BOOKING", label: "Re-Booking", sortOrder: 20 },
    { code: "CHANGES", label: "Changes", sortOrder: 30 },
    { code: "CANCELLATION_REFUND", label: "Cancelation & Refund", sortOrder: 40 },
    {
      code: "CANCELLATION_FUTURE_CREDIT",
      label: "Cancelation & Future Credit",
      sortOrder: 50,
    },
  ];

  for (const type of types) {
    await prisma.bookingType.upsert({
      where: { code: type.code },
      create: type,
      update: { label: type.label, sortOrder: type.sortOrder },
    });
  }

  console.log(`  ✓ ${types.length} booking types`);
}

async function seedBusinessSettings(): Promise<void> {
  const settings = [
    {
      key: "supported_currencies",
      value: ["USD", "CAD", "GBP", "EUR", "AUD"],
      description: "Currencies that may be selected on a booking.",
    },
    {
      key: "default_currency",
      value: "USD",
      description: "Currency pre-selected on new bookings.",
    },
    {
      key: "business_timezone",
      value: process.env["BUSINESS_TIMEZONE"] ?? "UTC",
      description: "Timezone used to bucket dates in reports.",
    },
    {
      key: "refund_approval_threshold_minor",
      value: 50_000,
      description:
        "Refunds at or above this amount in minor units require SUPER_ADMIN approval.",
    },
    {
      key: "document_max_bytes",
      value: 15 * 1024 * 1024,
      description: "Largest accepted document upload.",
    },
    {
      key: "document_allowed_content_types",
      value: [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
      ],
      description: "Content types accepted for document upload.",
    },
  ];

  for (const setting of settings) {
    await prisma.businessSetting.upsert({
      where: { key: setting.key },
      create: setting,
      update: { description: setting.description },
    });
  }

  console.log(`  ✓ ${settings.length} business settings`);
}

async function seedSuppliers(): Promise<void> {
  const mcoSuppliers = ["Skyhyflights", "Skyhyplanners"];

  for (const name of mcoSuppliers) {
    await prisma.mcoSupplier.upsert({
      where: { name },
      create: { name },
      update: {},
    });
  }

  await prisma.supplier.upsert({
    where: { name: "Airline website" },
    // `supportedProducts` is written out because a MySQL JSON column has no
    // literal DEFAULT. Empty means "no product restriction recorded", which
    // the booking forms read as selectable for everything.
    create: {
      name: "Airline website",
      type: SupplierType.AIRLINE,
      supportedProducts: [],
    },
    update: {},
  });

  console.log(`  ✓ ${mcoSuppliers.length} MCO suppliers, 1 supplier`);
}

async function provisionInitialAdmin(): Promise<void> {
  const existing = await prisma.adminUser.count();

  if (existing > 0) {
    console.log(`  • ${existing} administrator(s) already exist — skipping`);
    return;
  }

  const email = (process.env["INITIAL_ADMIN_EMAIL"] ?? "").trim().toLowerCase();

  if (!email) {
    console.log(
      "  • INITIAL_ADMIN_EMAIL is not set — no administrator created.\n" +
        "    Set INITIAL_ADMIN_EMAIL (and optionally INITIAL_ADMIN_PASSWORD) and re-run.",
    );
    return;
  }

  // When no password is supplied, generate one and print it exactly once. It is
  // never stored in plaintext and cannot be recovered afterwards.
  const supplied = process.env["INITIAL_ADMIN_PASSWORD"];
  const password = supplied ?? randomBytes(18).toString("base64url");

  const user = await prisma.adminUser.create({
    data: {
      email,
      name: process.env["INITIAL_ADMIN_NAME"] ?? "Super Admin",
      username: process.env["INITIAL_ADMIN_USERNAME"]?.toLowerCase() ?? null,
      passwordHash: await bcrypt.hash(password, 12),
      role: AdminRole.SUPER_ADMIN,
      // Forces a change at first sign-in, so a provisioning password never
      // becomes the long-lived credential.
      mustChangePassword: true,
    },
    select: { id: true, email: true },
  });

  console.log(`  ✓ SUPER_ADMIN created: ${user.email}`);

  if (!supplied) {
    console.log("");
    console.log("  ┌──────────────────────────────────────────────────────┐");
    console.log("  │ One-time password — shown now and never again:       │");
    console.log(`  │   ${password.padEnd(50)} │`);
    console.log("  │ You will be asked to change it at first sign-in.     │");
    console.log("  └──────────────────────────────────────────────────────┘");
    console.log("");
  }
}

async function main(): Promise<void> {
  console.log("Seeding Travel Booking CRM reference data…\n");

  await seedPermissions();
  await seedRolePermissions();
  await seedBookingTypes();
  await seedBusinessSettings();
  await seedSuppliers();
  await provisionInitialAdmin();

  console.log("\nSeed complete.");
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
