import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
    passWithNoTests: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
