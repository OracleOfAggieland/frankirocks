// UI boundary check tests (lab-ui-foundation R4.4, R5.1, R10.6, R16.1).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";
import { ENTRY_POINTS, checkPureModule, formatUiViolations, importsOf, reachable, scanUiBoundaries } from "./ui-boundaries.mjs";

const PERF = "performance" + ".now()";
const MISSING_PURE = "a listed pure module does not exist";
const MASCOT = "mascot" + "-reference.png";

describe("UI boundary check on the repo", () => {
  it("finds no violation", () => {
    const violations = scanUiBoundaries();
    expect(violations, formatUiViolations(violations)).toEqual([]);
  });

  it("walks the real import graph from page.tsx and layout.tsx", () => {
    const seen = reachable(ENTRY_POINTS, (f: string) => readFileSync(join(REPO_ROOT, f), "utf8"), (f: string) => existsSync(join(REPO_ROOT, f)));
    for (const f of ["apps/web/src/components/App.tsx", "apps/web/src/components/Footer.tsx", "apps/web/src/client/voice-client.ts", "packages/core/src/index.ts"]) {
      expect(seen.has(f), f).toBe(true);
    }
    expect([...seen.keys()].some((f: string) => f.startsWith("apps/web/src/app/specimens/"))).toBe(false);
  });
});

describe("importsOf", () => {
  it("marks type-only imports", () => {
    const found = importsOf(
      [
        'import type { A } from "./a";',
        'import { type B, type C } from "./b";',
        'import { D, type E } from "./d";',
        'export { F } from "./f";',
        'import "./side";',
      ].join("\n"),
    );
    expect(found.map((i: { specifier: string; typeOnly: boolean }) => [i.specifier, i.typeOnly])).toEqual([
      ["./a", true],
      ["./b", true],
      ["./d", false],
      ["./f", false],
      ["./side", false],
    ]);
  });
});

describe("UI boundary rules on fake trees", () => {
  let root: string | null = null;
  afterEach(() => {
    if (root !== null) rmSync(root, { recursive: true, force: true });
    root = null;
  });
  const tree = (files: Record<string, string>) => {
    root = mkdtempSync(join(tmpdir(), "ui-boundaries-"));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return scanUiBoundaries(root)
      .filter((v: { rule: string }) => v.rule !== MISSING_PURE)
      .map((v: { file: string; match: string }) => `${v.file}: ${v.match}`);
  };
  const treeAll = (files: Record<string, string>) => {
    tree(files);
    return scanUiBoundaries(root!) as { file: string; match: string; rule: string }[];
  };

  it("fails a listed pure module that does not exist", () => {
    const missing = treeAll({ "apps/web/src/ui/motion.ts": "export const A = 1;\n" }).filter((v) => v.rule === MISSING_PURE);
    expect(missing.map((v) => v.file)).toContain("apps/web/src/ui/avatar/look.ts");
    expect(missing.map((v) => v.file)).not.toContain("apps/web/src/ui/motion.ts");
  });

  it("rule 2 fails a Specimens module reachable from page.tsx or layout.tsx", () => {
    expect(
      tree({
        "apps/web/src/app/page.tsx": 'import { App } from "../components/App";\n',
        "apps/web/src/app/layout.tsx": 'import "./globals.css";\nimport { Footer } from "../components/Footer";\n',
        "apps/web/src/components/Footer.tsx": "export const Footer = 1;\n",
        "apps/web/src/components/App.tsx": 'import { X } from "./helper";\n',
        "apps/web/src/components/helper.ts": 'export { CARDS as X } from "../app/specimens/_fixtures";\n',
        "apps/web/src/app/specimens/_fixtures/index.ts": "export const CARDS = [];\n",
        "apps/web/src/app/specimens/page.dev.tsx": 'import { CARDS } from "./_fixtures";\n',
      }),
    ).toEqual([
      "apps/web/src/components/helper.ts: apps/web/src/app/specimens/_fixtures/index.ts",
      "apps/web/src/components/helper.ts: ../app/specimens/_fixtures",
    ]);
  });

  it("rule 2 passes when the Specimens_Page is reachable only from itself and tests", () => {
    expect(
      tree({
        "apps/web/src/app/page.tsx": 'import { App } from "../components/App";\n',
        "apps/web/src/components/App.tsx": "export const App = 1;\n",
        "apps/web/src/components/Footer.test.tsx": 'import Page from "../app/specimens/page.dev";\n',
        "apps/web/src/app/specimens/page.dev.tsx": 'import { CARDS } from "./_fixtures";\n',
        "apps/web/src/app/specimens/_fixtures/index.ts": "export const CARDS = [];\n",
      }),
    ).toEqual([]);
  });

  it("fails any other .dev.tsx file", () => {
    expect(
      tree({
        "apps/web/src/app/specimens/page.dev.tsx": "export default 1;\n",
        "apps/web/src/app/secret/page.dev.tsx": "export default 1;\n",
      }),
    ).toEqual(["apps/web/src/app/secret/page.dev.tsx: .dev.tsx"]);
  });

  it("rule 3 passes pure imports and fails other imports and browser globals", () => {
    expect(
      tree({
        "apps/web/src/ui/motion.ts": "export const A = 1;\n",
        "apps/web/src/ui/copy.ts": 'import type { AvatarState } from "@franki/core";\n',
        "apps/web/src/ui/avatar/look.ts": 'import { A } from "../motion";\nimport { x } from "@franki/core";\nimport type { R } from "react";\n',
      }),
    ).toEqual([]);
    expect(
      tree({
        "apps/web/src/ui/avatar/look.ts": 'import { useState } from "react";\nimport { m } from "../levels/level-meter";\n',
        "apps/web/src/ui/announce.ts": "const w = window.innerWidth;\nconst r = Math.random();\n",
      }),
    ).toEqual([
      "apps/web/src/ui/avatar/look.ts: react",
      "apps/web/src/ui/avatar/look.ts: ../levels/level-meter",
      "apps/web/src/ui/announce.ts: window",
      "apps/web/src/ui/announce.ts: Math.random",
    ]);
  });

  it("rule 3 lists each browser global", () => {
    for (const word of ["document", "navigator", "localStorage", "fetch", "requestAnimationFrame", "AudioContext"]) {
      expect(checkPureModule("apps/web/src/ui/look.ts", `const x = ${word};`).map((v: { match: string }) => v.match)).toEqual([word]);
    }
    expect(checkPureModule("apps/web/src/ui/look.ts", "const windowed = 1; const myfetch = 2;")).toEqual([]);
  });

  it("rule 4 fails a performance clock read in components/ or ui/, not in tests or elsewhere", () => {
    expect(
      tree({
        "apps/web/src/components/A.tsx": `const t = ${PERF};\n`,
        "apps/web/src/ui/hooks/b.ts": `const t = ${PERF};\n`,
        "apps/web/src/ui/b.test.ts": `const t = ${PERF};\n`,
        "apps/web/src/client/clock.ts": `const t = ${PERF};\n`,
      }),
    ).toEqual([`apps/web/src/components/A.tsx: ${PERF.slice(0, -1)}`, `apps/web/src/ui/hooks/b.ts: ${PERF.slice(0, -1)}`]);
  });

  it("rule 5 fails a Surface importing from client/", () => {
    expect(
      tree({
        "apps/web/src/client/api.ts": "export const api = 1;\n",
        "apps/web/src/components/surfaces/Card.tsx": 'import { api } from "../../client/api";\n',
        "apps/web/src/components/App.tsx": 'import { api } from "../client/api";\n',
      }),
    ).toEqual(["apps/web/src/components/surfaces/Card.tsx: ../../client/api"]);
  });

  it("fails any reference to the mascot concept art under src or public", () => {
    expect(
      tree({
        "apps/web/src/components/Ghost.tsx": `const src = "/${MASCOT}";\n`,
        "apps/web/public/notes.txt": `see ${MASCOT}\n`,
        "docs/other.md": `${MASCOT}\n`,
      }),
    ).toEqual(["apps/web/src/components/Ghost.tsx: mascot-reference", "apps/web/public/notes.txt: mascot-reference"]);
  });
});
