import { defineConfig } from "vitest/config";

// Unit and property tests. They use fakes only and never touch real accounts or services.
// test/setup.ts blocks all network access, so a test that tries to reach a service fails.
export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "functions/src/**/*.test.ts",
      "scripts/**/*.test.ts",
      "test/**/*.test.ts",
    ],
    setupFiles: ["test/setup.ts"],
  },
});
