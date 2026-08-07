import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./*" path alias — without this,
    // tsc accepts an "@/..." import (it only type-checks) but vitest can't
    // actually resolve it at runtime. Only latent until now because no
    // existing test transitively imported a file using that alias.
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.test.ts"],
    // Multiple test files each spin up their own PGlite instance (real
    // Postgres compiled to WASM) plus real network connections (RPC,
    // Supabase) — running those in separate parallel worker processes hit
    // a real crash in this environment (V8 fatal error / worker channel
    // closed), not a code bug. Single fork trades some wall-clock time for
    // not crashing.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
