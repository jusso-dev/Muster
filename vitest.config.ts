import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/ops/src/**/*.test.ts"],
  },
});
