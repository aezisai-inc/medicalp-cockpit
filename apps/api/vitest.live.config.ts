import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/live/**/*.spec.ts"],
    testTimeout: 60000,
  },
});
