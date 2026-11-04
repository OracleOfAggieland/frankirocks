import { defineConfig } from "vitest/config";

// Unit and property tests. They use fakes only and never touch real accounts or services.
// tests/setup/setup.ts blocks all network access, so a test that tries to reach a service fails.
// tests/firestore needs the emulator and runs only through vitest.emulator.config.ts.
export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "functions/src/**/*.test.ts",
      "scripts/**/*.test.ts",
      "tests/setup/**/*.test.ts",
      "apps/web/src/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["tests/setup/setup.ts"],
  },
});
