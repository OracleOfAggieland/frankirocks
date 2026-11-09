import { defineConfig } from "vitest/config";

// Tests that need the Firebase emulators (Java 21). Run with `npm run test:emulator`; CI runs them.
// `npm test` never includes these (R8.7, R31.6).
export default defineConfig({
  test: {
    include: ["tests/firestore/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
