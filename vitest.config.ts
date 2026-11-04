import { defineConfig } from "vitest/config";

// Unit and property tests. They use fakes only and never touch real accounts or services.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "functions/src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
