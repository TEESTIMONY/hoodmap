import { defineConfig } from "drizzle-kit";

// Generates/runs SQL migrations for lib/indexer/schema.ts against
// DATABASE_URL. Usage once a Postgres instance exists:
//   npx drizzle-kit generate   # writes SQL migration files from schema.ts
//   npx drizzle-kit migrate    # applies them to DATABASE_URL
export default defineConfig({
  schema: "./lib/indexer/schema.ts",
  out: "./lib/indexer/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
