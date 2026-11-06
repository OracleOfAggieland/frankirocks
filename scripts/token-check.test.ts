// Token_Check tests (lab-ui-foundation R3.4 to R3.7). The repo scan runs on every `npm test` (R3.6).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";
import { findTokenViolations, formatTokenViolations, isSkipped, scanTokens } from "./token-check.mjs";

const TSX = "apps/web/src/components/Sample.tsx";
const CSS = "apps/web/src/components/sample.css";
const kinds = (path: string, text: string) => findTokenViolations(path, text).map((v: { kind: string }) => v.kind);

describe("Token_Check on the repo", () => {
  it("finds no raw colour, ad hoc duration or palette class in components/ and ui/", () => {
    const violations = scanTokens();
    expect(violations, formatTokenViolations(violations)).toEqual([]);
  });
});

describe("findTokenViolations examples", () => {
  it.each(["#fff", "#FFFA", "#0B1311", "#7CFFB2CC"])("reports the hex colour %s", (hex) => {
    expect(findTokenViolations(TSX, `const a = 1;\nconst c = "${hex}";\n`)).toEqual([{ line: 2, match: hex, kind: "hex" }]);
  });

  it("reports hex inside a Tailwind arbitrary value and an SVG attribute", () => {
    expect(kinds(TSX, '<div className="bg-[#0B1311]" />')).toEqual(["hex"]);
    expect(kinds(TSX, '<path fill="#93DDA2" />')).toEqual(["hex"]);
  });

  it("skips anchors, HTML entities and wrong-length hex runs", () => {
    expect(kinds(TSX, 'href="#section-id"')).toEqual([]);
    expect(kinds(TSX, '"#12345"')).toEqual([]);
    expect(kinds(TSX, '"#123456789"')).toEqual([]);
    expect(kinds(TSX, "&#123;")).toEqual([]);
  });

  it.each([
    "transition: opacity 320ms;",
    "transition-duration: .3s;",
    "animation: float 4s infinite;",
    "animation-duration: 1200ms;",
    "animation-delay: 40ms;",
  ])("reports the CSS duration in %s", (decl) => {
    expect(kinds(CSS, `.a {\n  ${decl}\n}`)).toEqual(["duration"]);
  });

  it.each(["duration-200", "delay-75", "duration-[320ms]", "delay-[1s]"])("reports the Tailwind class %s", (cls) => {
    expect(kinds(TSX, `<div className="transition ${cls}" />`)).toEqual(["duration"]);
  });

  it.each(["{ duration: 0.3 }", "{ delay: 200 }", "{ duration: .5 }", "{ type: 'spring', delay: -1 }"])(
    "reports the numeric key in %s",
    (obj) => {
      expect(kinds(TSX, `animate(el, ${obj});`)).toEqual(["duration"]);
    },
  );

  it.each(['<animate dur="2s" />', '<animate begin="0.5s" />', "<animate dur={'300ms'} />"])("reports SVG timing in %s", (svg) => {
    expect(kinds(TSX, svg)).toEqual(["duration"]);
  });

  it.each(["bg-zinc-950", "text-emerald-400", "hover:border-red-600", "ring-amber-300", "text-white", "bg-black/40"])(
    "reports the palette class %s",
    (cls) => {
      expect(kinds(TSX, `<div className="${cls}" />`)).toEqual(["palette"]);
    },
  );

  it("accepts token references", () => {
    const ok = [
      "transition: opacity var(--dur-base) var(--ease-ecto);",
      "animation: float calc(var(--dur-ritual) * 4) infinite;",
      '<div className="duration-(--dur-base) delay-[var(--stagger)] bg-night-0 text-ink ring-brass" />',
      "const t = { duration: DUR.base / 1000, delay: STAGGER / 1000 };",
      "const c = COLOR.ecto;",
      '<animate begin="indefinite" />',
    ].join("\n");
    expect(findTokenViolations(TSX, ok)).toEqual([]);
  });

  it("checks numeric duration keys only in .ts and .tsx", () => {
    expect(kinds("apps/web/src/components/a.css", "{ duration: 3 }")).toEqual([]);
    expect(kinds("apps/web/src/ui/a.ts", "{ duration: 3 }")).toEqual(["duration"]);
  });

  it("skips the Token_Files and test files", () => {
    expect(isSkipped("apps/web/src/ui/motion.ts")).toBe(true);
    expect(isSkipped("apps/web/src/app/globals.css")).toBe(true);
    expect(isSkipped("apps/web/src/components/Card.test.tsx")).toBe(true);
    expect(isSkipped("apps/web/src/components/Card.tsx")).toBe(false);
  });
});

describe("Token_Check CLI", () => {
  let root: string | null = null;
  afterEach(() => {
    if (root !== null) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  const tree = (files: Record<string, string>) => {
    root = mkdtempSync(join(tmpdir(), "token-check-"));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return spawnSync(process.execPath, [join(REPO_ROOT, "scripts/token-check.mjs"), root], { encoding: "utf8" });
  };

  it("exits 1 and prints path:line: match per violation", () => {
    const run = tree({
      "apps/web/src/components/Bad.tsx": 'const a = 1;\nconst c = "#fff";\n',
      "apps/web/src/ui/motion.ts": 'export const C = "#060A09";\n',
      "apps/web/src/components/Bad.test.tsx": 'const c = "#000";\n',
    });
    expect(run.status).toBe(1);
    expect(run.stdout.trim()).toBe("apps/web/src/components/Bad.tsx:2: #fff");
  });

  it("exits 0 on a clean tree", () => {
    const run = tree({ "apps/web/src/components/Good.tsx": 'const c = "bg-night-0";\n' });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
  });
});

// Feature: lab-ui-foundation, Property 18: Token_Check finds raw values
describe("Property 18: Token_Check finds raw values", () => {
  const TOKEN_LINES = [
    "transition: opacity var(--dur-base) var(--ease-ecto);",
    '<div className="duration-(--dur-quick) bg-night-2 text-ink-dim" />',
    "const spring = { ...SPRING.settle, duration: DUR.base / 1000 };",
    "const delay = { delay: STAGGER / 1000 };",
    '<path stroke="var(--color-spark)" />',
    "animation-duration: var(--dur-ritual);",
    "const c = COLOR.brass;",
    "",
  ];
  const tokenLine = fc.constantFrom(...TOKEN_LINES);
  const hexDigit = fc.constantFrom(..."0123456789abcdefABCDEF".split(""));
  const hex = fc
    .constantFrom(3, 4, 6, 8)
    .chain((n) => fc.array(hexDigit, { minLength: n, maxLength: n }))
    .map((d) => `#${d.join("")}`);
  const amount = fc.integer({ min: 1, max: 5000 });
  const duration = fc.oneof(
    fc.tuple(fc.constantFrom("transition", "animation-duration", "animation-delay"), amount, fc.constantFrom("ms", "s")).map(
      ([prop, n, unit]) => ({ snippet: `${prop}: ${n}${unit};`, key: `${n}${unit}` }),
    ),
    fc.tuple(fc.constantFrom("duration", "delay"), amount).map(([p, n]) => ({ snippet: `"${p}-${n}"`, key: `${p}-${n}` })),
    fc.tuple(fc.constantFrom("duration", "delay"), amount).map(([p, n]) => ({ snippet: `{ ${p}: ${n} }`, key: `${p}: ${n}` })),
    fc.tuple(fc.constantFrom("dur", "begin"), amount).map(([p, n]) => ({ snippet: `<animate ${p}="${n}ms" />`, key: `${p}="${n}ms"` })),
  );

  it("reports an inserted raw value on its line, and nothing for token-only text", () => {
    fc.assert(
      fc.property(
        fc.array(tokenLine, { minLength: 0, maxLength: 20 }),
        fc.nat(),
        fc.oneof(hex.map((h) => ({ snippet: `const c = "${h}";`, key: h, kind: "hex" })), duration.map((d) => ({ ...d, kind: "duration" }))),
        (lines, at, inserted) => {
          expect(findTokenViolations(TSX, lines.join("\n"))).toEqual([]);
          const index = lines.length === 0 ? 0 : at % (lines.length + 1);
          const withRaw = [...lines.slice(0, index), inserted.snippet, ...lines.slice(index)];
          const found = findTokenViolations(TSX, withRaw.join("\n"));
          expect(found.length).toBeGreaterThanOrEqual(1);
          expect(found.every((v: { line: number }) => v.line === index + 1)).toBe(true);
          expect(found.some((v: { match: string; kind: string }) => v.kind === inserted.kind && v.match.includes(inserted.key))).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
