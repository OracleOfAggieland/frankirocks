import { existsSync, readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EXCLUDED_DIRS, saveHookMatcher, segmentNotIn } from "./save-hook-matcher.mjs";

const HOOK_FILE = ".kiro/hooks/invariants-on-save.json";

const matcher = new RegExp(saveHookMatcher());

describe("save hook matcher", () => {
  it.each([
    "packages/core/src/schema/v.ts",
    "packages/server/src/store/memory-store.test.ts",
    "packages/core/vitest.config.ts",
    "apps/web/src/app/page.tsx",
    "apps/web/src/app/api/health/route.ts",
    "C:\\Users\\me\\frankirocks\\packages\\core\\src\\text.ts",
    "/home/me/frankirocks/apps/web/src/components/DebugPanel.tsx",
    "packages/core/src/distance/dist.ts",
    "packages/core/src/nodes/node_modules_like.ts",
    "packages/core/src/.nextish/a.ts",
  ])("matches %s", (path) => expect(matcher.test(path)).toBe(true));

  it.each([
    "packages/core/node_modules/fast-check/lib/index.ts",
    "packages/server/dist/index.ts",
    "apps/web/src/.next/types/app/page.ts",
    "C:\\repo\\packages\\core\\node_modules\\x\\y.tsx",
    "packages/core/src/schema/v.js",
    "packages/core/src/schema/v.ts.bak",
    "apps/web/next.config.ts",
    "functions/src/index.ts",
    "scripts/clock-guard.test.ts",
  ])("does not match %s", (path) => expect(matcher.test(path)).toBe(false));

  it("a segment matches exactly when it is not an excluded name", () => {
    const seg = new RegExp(`^${segmentNotIn(EXCLUDED_DIRS)}$`);
    const name = fc.oneof(
      fc.constantFrom(...EXCLUDED_DIRS, "d", "di", "dis", "distx", "n", "node", "node_module", "node_modulesx", ".", ".nex", ".nextx", "src"),
      fc.stringMatching(/^[a-z._-]{1,14}$/),
    );
    fc.assert(
      fc.property(name, (s) => {
        expect(seg.test(s), s).toBe(!EXCLUDED_DIRS.includes(s));
      }),
      { numRuns: 2000 },
    );
  });

  it("uses no lookaround, so non-JavaScript regex engines accept it", () => {
    expect(saveHookMatcher()).not.toMatch(/\(\?[=!<]/);
  });
});

// The hook file could not be written by the agent (permission prompt failed; see tasks.md task 13).
// Once it exists, this keeps it in step with the generated matcher and the root test:fast script (R3.4).
describe.skipIf(!existsSync(HOOK_FILE))("invariants-on-save hook file", () => {
  it("is a v1 PostFileSave hook running npm run test:fast with the generated matcher", () => {
    const file = JSON.parse(readFileSync(HOOK_FILE, "utf8")) as {
      version: string;
      hooks: { trigger: string; matcher: string; action: { type: string; command: string } }[];
    };
    expect(file.version).toBe("v1");
    expect(file.hooks).toHaveLength(1);
    expect(file.hooks[0]).toMatchObject({
      trigger: "PostFileSave",
      matcher: saveHookMatcher(),
      action: { type: "command", command: "npm run test:fast" },
    });
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:fast"]).toMatch(/^vitest run /);
  });
});
