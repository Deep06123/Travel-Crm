import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    /**
     * Connection used by the Prisma CLI — migrations, studio, seeding.
     *
     * Managed MySQL providers often hand out two strings: a pooled one for the
     * application and a direct one for everything else. Schema changes must not
     * go through a proxy that multiplexes connections, which cannot hold the
     * session state DDL and metadata locks depend on, so `DIRECT_URL` wins here
     * when it is set. The running application keeps using `DATABASE_URL` via
     * `src/lib/db/prisma.ts`, which is where pooling is wanted.
     *
     * On a single-host deployment there is only one string: leave `DIRECT_URL`
     * unset and this falls through to `DATABASE_URL`.
     */
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
    // Only needed when the development database's user may not CREATE DATABASE,
    // which is how a managed MySQL is usually provisioned — `migrate dev` wants
    // a scratch schema to verify a migration against.
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});
