// Production DB client — connects to a real Postgres instance (Neon,
// Supabase, Vercel Postgres, or any standard connection string) via
// DATABASE_URL. Deliberately NOT imported by the ingest worker's core
// logic directly (see worker.ts's `createSync(db)` factory) — that keeps
// the sync logic testable against an in-process Postgres (PGlite) without
// needing a real database to exist yet.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

let cached: ReturnType<typeof createDb> | null = null;

// Lazy + cached so importing this module doesn't require DATABASE_URL to
// exist (e.g. during a build step) — only calling db() does, and only once
// per process.
export function db() {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. This is required for the indexer (schema.ts tables) — " +
        "provision a Postgres instance (e.g. Neon, Supabase, Vercel Postgres) and set the connection string.",
    );
  }
  cached = createDb(url);
  return cached;
}

export type Db = ReturnType<typeof createDb>;
