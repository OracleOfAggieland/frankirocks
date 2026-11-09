import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findClockViolations, formatViolations, loadAllowList, scanRepo } from "./clock-check.mjs";

// Built from pieces so this file never trips a text search for the real thing.
const NOW_CALL = "Date" + ".now()";
const EMPTY_DATE = "new " + "Date()";

const temps: string[] = [];

function fixtureRepo(files: Record<string, string>, allow: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "clock-guard-"));
  temps.push(root);
  const all = { "scripts/clock-allowlist.json": JSON.stringify({ files: allow }), ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

afterEach(() => {
  for (const root of temps.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("static clock check", () => {
  it("flags Date.now outside the allow-list", () => {
    const root = fixtureRepo(
      {
        "packages/core/src/a.ts": `export const x = 1;\nexport const t = ${NOW_CALL};\n`,
        "packages/server/src/clock/live-clock.ts": `export const t = ${NOW_CALL};\n`,
      },
      ["packages/server/src/clock/live-clock.ts"],
    );
    const violations = scanRepo(root);
    expect(violations).toEqual([{ file: "packages/core/src/a.ts", line: 2, match: "Date" + ".now(" }]);
    expect(formatViolations(violations)).toBe("packages/core/src/a.ts:2: Date" + ".now(");
  });

  it("flags empty new Date() in comments, strings and test files", () => {
    const root = fixtureRepo(
      {
        "apps/web/src/b.test.tsx": `// ${EMPTY_DATE}\nconst s = "${NOW_CALL}";\n`,
        "functions/src/c.cjs": `const d = new   Date( );\n`,
      },
      ["functions/src/clock.ts"],
    );
    const files = scanRepo(root).map((v) => `${v.file}:${v.line}`);
    expect(files).toEqual(["apps/web/src/b.test.tsx:1", "apps/web/src/b.test.tsx:2", "functions/src/c.cjs:1"]);
  });

  it("passes new Date(x)", () => {
    expect(findClockViolations("checkedAt: new Date(deps.now()).toISOString(),")).toEqual([]);
    expect(findClockViolations("new Date(0); new Date(ms)")).toEqual([]);
  });

  it("skips node_modules, dist and .next", () => {
    const root = fixtureRepo(
      {
        "packages/core/node_modules/x/i.js": NOW_CALL,
        "functions/src/dist/i.js": NOW_CALL,
        "apps/web/src/.next/i.js": NOW_CALL,
        "packages/core/src/readme.md": NOW_CALL,
      },
      ["functions/src/clock.ts"],
    );
    expect(scanRepo(root)).toEqual([]);
  });

  it("allow-list holds 1 to 5 files, including the three Clock_Port files", () => {
    const allow = loadAllowList();
    expect(allow.length).toBeGreaterThanOrEqual(1);
    expect(allow.length).toBeLessThanOrEqual(5);
    expect(allow).toEqual([
      "packages/server/src/clock/live-clock.ts",
      "apps/web/src/client/clock.ts",
      "functions/src/clock.ts",
    ]);
  });

  it("repo has zero violations", () => {
    const violations = scanRepo();
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});
