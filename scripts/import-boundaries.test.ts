import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_EXAMPLES,
  areaOf,
  checkFile,
  extractSpecifiers,
  formatImportViolations,
  scanImports,
} from "./import-boundaries.mjs";

const FILES = {
  core: "packages/core/src/sample.ts",
  server: "packages/server/src/sample.ts",
  browser: "apps/web/src/components/Sample.tsx",
  route: "apps/web/src/app/api/sample/route.ts",
} as const;

type Area = keyof typeof FILES;

const forms = (spec: string) => [
  `import x from "${spec}";`,
  `import type { X } from '${spec}';`,
  `import "${spec}";`,
  `export { y } from "${spec}";`,
  `export * from "${spec}";`,
  `const m = await import("${spec}");`,
  `const r = require('${spec}');`,
];

const cases = (Object.keys(FORBIDDEN_EXAMPLES) as Area[]).flatMap((area) =>
  FORBIDDEN_EXAMPLES[area].map((spec: string) => [area, spec] as const),
);

describe("import-boundary check", () => {
  it.each(cases)("%s rejects %s", (area, spec) => {
    for (const source of forms(spec)) {
      const violations = checkFile(FILES[area], `// header\n${source}\n`);
      expect(violations, source).toHaveLength(1);
      expect(violations[0]).toMatchObject({ file: FILES[area], line: 2, specifier: spec });
    }
  });

  it("reads multi-line imports", () => {
    const text = 'import {\n  a,\n  b,\n} from "firebase-admin/app";\n';
    expect(extractSpecifiers(text)).toEqual([{ specifier: "firebase-admin/app", line: 4 }]);
  });

  it("allows the expected imports", () => {
    expect(checkFile(FILES.core, 'import fc from "fast-check";\nimport { a } from "./clock";\n')).toEqual([]);
    expect(checkFile(FILES.server, 'import { getApps } from "firebase-admin/app";\nimport OpenAI from "openai";\nimport { x } from "@franki/core";\n')).toEqual([]);
    expect(checkFile(FILES.browser, 'import { x } from "@franki/core";\nimport { initializeApp } from "firebase/app";\n')).toEqual([]);
    expect(checkFile(FILES.route, 'import { runDeepHealth } from "@franki/server";\nimport { after } from "next/server";\n')).toEqual([]);
    expect(checkFile(FILES.server, 'import next from "nextish";\n')).toEqual([]);
  });

  it("rejects relative imports across package boundaries", () => {
    expect(checkFile(FILES.core, 'import { x } from "../../server/src/live";\n')[0]?.rule).toBe(
      "relative import into packages/server/",
    );
    expect(checkFile(FILES.core, 'import { x } from "../../../apps/web/src/a";\n')).toHaveLength(1);
    expect(checkFile(FILES.core, 'import { x } from "../../../functions/src/clock";\n')).toHaveLength(1);
    expect(checkFile(FILES.server, 'import { x } from "../../../apps/web/src/a";\n')).toHaveLength(1);
    expect(checkFile(FILES.browser, 'import { x } from "../../../../packages/server/src/live";\n')).toHaveLength(1);
  });

  it("rejects wall-clock calls in core only", () => {
    const calls = ["Date" + ".now()", "new " + "Date()", "performance" + ".now()"];
    for (const call of calls) {
      const [violation] = checkFile(FILES.core, `const a = 1;\nconst t = ${call};\n`);
      expect(violation).toMatchObject({ line: 2, call, rule: "wall-clock read in core" });
    }
    expect(checkFile(FILES.core, "const t = new Date(ms);\n")).toEqual([]);
  });

  it("skips test files and unchecked paths", () => {
    expect(areaOf("packages/core/src/a.test.ts")).toBeNull();
    expect(areaOf("packages/core/src/a.d.ts")).toBeNull();
    expect(areaOf("functions/src/index.ts")).toBeNull();
    expect(areaOf("packages/core/src/a.ts")).toBe("core");
  });

  it("repo has zero violations", () => {
    const violations = scanImports();
    expect(violations, formatImportViolations(violations)).toEqual([]);
  });
});
