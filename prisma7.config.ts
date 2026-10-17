import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
    // Only needed when the development database cannot create its own shadow
    // database, which is the case for the bundled `prisma dev` server.
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});
