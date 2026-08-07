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
  },
});
