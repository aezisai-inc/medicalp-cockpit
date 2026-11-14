import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/acceptance/**/*.spec.ts"],
    testTimeout: 30000,
  },
});
