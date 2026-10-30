import { defineConfig } from "vitest/config";

// Tests that need the Firebase emulators. Run with `npm run test:emulator`.
export default defineConfig({
  test: {
    include: ["tests/rules/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
