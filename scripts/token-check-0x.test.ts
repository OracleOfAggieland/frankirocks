// Token_Check `0x` colour rule and its one directory allow-list entry (brief 013 WP17).
// The repo-wide scan stays in token-check.test.ts; this file pins the new rule only.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";
import { TOKEN_0X_ALLOW, find0xColours, findTokenViolations, isAllowed0x, isSkipped } from "./token-check.mjs";

const TSX = "apps/web/src/components/Sample.tsx";
const UI = "apps/web/src/ui/sample.ts";
const ENGINE = "apps/web/src/components/avatar/three/stage.ts";
const ENGINE_DIR = "apps/web/src/components/avatar/three/";
type Violation = { line: number; match: string; kind: string };
const found = (path: string, text: string): Violation[] => findTokenViolations(path, text);
const kinds = (path: string, text: string) => found(path, text).map((v) => v.kind);

describe("the 0x colour rule", () => {
  it.each(["0x93DDA2", "0x7cffb2", "0X060A09", "0xFF_D2_4D", "0x000000", "0xffffff"])("reports %s outside the engine", (lit) => {
    expect(found(TSX, `const a = 1;\nconst c = new THREE.Color(${lit});\n`)).toEqual([{ line: 2, match: lit, kind: "hex-0x" }]);
  });

  it("reports it in ui/, in strings and in comments, as the # rule does", () => {
    expect(kinds(UI, "export const C = 0x93DDA2;")).toEqual(["hex-0x"]);
    expect(kinds(TSX, 'const c = Number("0x93DDA2");')).toEqual(["hex-0x"]);
    expect(kinds(TSX, "// was 0x93DDA2 before the token")).toEqual(["hex-0x"]);
  });

  it("passes integers that are not six-digit colours", () => {
    const ok = [
      "return (seed * 7919 + 0x5bd1e995) >>> 0;",
      "a = (a + 0x6d2b79f5) >>> 0;",
      "const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);",
      "const rand = mulberry32(0x5eed);",
      "const m = 0xff & x;",
      "const big = 0x1234567n;",
      "const n = 0x12345;",
      "const id = a0x93DDA2;",
      "const s = $0x93DDA2;",
      "const k = 0x93DDA2n;",
      "const w = 0x93DDA2_FF;",
    ].join("\n");
    expect(found(TSX, ok)).toEqual([]);
  });

  it("returns each hit's position in find0xColours", () => {
    expect(find0xColours("a(0x112233, 0xFFFFFFFF, 0x445566)")).toEqual([
      { index: 2, match: "0x112233" },
      { index: 24, match: "0x445566" },
    ]);
    expect(find0xColours("")).toEqual([]);
  });

  it("sorts 0x hits among the other kinds by position", () => {
    expect(found(TSX, 'const a = 0x112233; const b = "#fff";\nconst c = 0x445566;')).toEqual([
      { line: 1, match: "0x112233", kind: "hex-0x" },
      { line: 1, match: "#fff", kind: "hex" },
      { line: 2, match: "0x445566", kind: "hex-0x" },
    ]);
  });
});

describe("the one directory allow-list entry", () => {
  it("has exactly one entry: the three.js engine directory, with its reason", () => {
    expect(TOKEN_0X_ALLOW).toEqual([
      {
        dir: ENGINE_DIR,
        reason: "the three.js engine's tuned palette, light colours and shader constants, ported verbatim from the prototype",
      },
    ]);
    expect(Object.isFrozen(TOKEN_0X_ALLOW)).toBe(true);
    expect(Object.isFrozen(TOKEN_0X_ALLOW[0])).toBe(true);
  });

  it("waives only the 0x rule inside the engine directory", () => {
    expect(found(ENGINE, "const keyLight = new THREE.DirectionalLight(0xFFE7C4, 2.5);")).toEqual([]);
    expect(found(`${ENGINE_DIR}sub/deeper.ts`, "const c = 0xFFE7C4;")).toEqual([]);
    expect(kinds(ENGINE, 'const c = "#FFE7C4";')).toEqual(["hex"]);
    expect(kinds(ENGINE, "animate(el, { duration: 0.3 });")).toEqual(["duration"]);
    expect(kinds(ENGINE, '<div className="bg-zinc-950" />')).toEqual(["palette"]);
  });

  it.each([
    ["apps/web/src/components/avatar/three/stage.ts", true],
    ["apps/web/src/components/avatar/three/config.ts", true],
    ["apps\\web\\src\\components\\avatar\\three\\stage.ts", true],
    ["./apps/web/src/components/avatar/three/stage.ts", true],
    ["apps/web/src/components/avatar/three-host.ts", false],
    ["apps/web/src/components/avatar/ThreeGhost.tsx", false],
    ["apps/web/src/components/avatar/threeX/stage.ts", false],
    ["apps/web/src/components/avatar/three", false],
    ["apps/web/src/components/avatar/three/../Electricity.tsx", false],
    ["apps/web/src/ui/avatar/three/stage.ts", false],
    ["other/apps/web/src/components/avatar/three/stage.ts", false],
    ["apps/web/src/components/Sample.tsx", false],
  ])("isAllowed0x(%s) is %s", (path, allowed) => {
    expect(isAllowed0x(path)).toBe(allowed);
  });

  it("is still needed: the engine's own source holds 0x colours", () => {
    const dir = join(REPO_ROOT, ENGINE_DIR);
    const sources = readdirSync(dir).filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !isSkipped(`${ENGINE_DIR}${f}`));
    const hits = sources.flatMap((f) => find0xColours(readFileSync(join(dir, f), "utf8")));
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("Token_Check CLI with the 0x rule", () => {
  let root: string | null = null;
  afterEach(() => {
    if (root !== null) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  const tree = (files: Record<string, string>) => {
    root = mkdtempSync(join(tmpdir(), "token-check-0x-"));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return spawnSync(process.execPath, [join(REPO_ROOT, "scripts/token-check.mjs"), root], { encoding: "utf8" });
  };

  it("exits 1 for a 0x colour outside the engine and ignores the engine's own", () => {
    const run = tree({
      "apps/web/src/components/Bad.tsx": "const a = 1;\nconst c = 0x93DDA2;\n",
      "apps/web/src/components/avatar/three/config.ts": "export const COLORS = { body: 0xD6F5CF };\n",
      "apps/web/src/components/avatar/three-host.ts": "const ok = 0x5bd1e995;\n",
    });
    expect(run.status).toBe(1);
    expect(run.stdout.trim()).toBe("apps/web/src/components/Bad.tsx:2: 0x93DDA2");
  });

  it("exits 1 for a raw #hex inside the engine directory", () => {
    const run = tree({ "apps/web/src/components/avatar/three/config.ts": "// C99A4A, was #C99A4A\nconst c = 0xC99A4A;\n" });
    expect(run.status).toBe(1);
    expect(run.stdout.trim()).toBe("apps/web/src/components/avatar/three/config.ts:1: #C99A4A");
  });

  it("exits 0 when the only 0x colours are in the engine", () => {
    const run = tree({
      "apps/web/src/components/avatar/three/stage.ts": "new THREE.PointLight(0xFFB45A, 1.1, 9, 2);\n",
      "apps/web/src/components/Good.tsx": 'const c = "bg-night-0";\n',
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
  });
});

// Feature: brief 013 WP17, Property: the 0x rule finds every 0xRRGGBB outside the engine and none inside
describe("Property: the 0x rule and its allow-list entry", () => {
  const hexDigit = fc.constantFrom(..."0123456789abcdefABCDEF".split(""));
  const colour = fc
    .tuple(fc.constantFrom("0x", "0X"), fc.array(hexDigit, { minLength: 6, maxLength: 6 }))
    .map(([p, d]) => `${p}${d.join("")}`);
  const notColour = fc
    .tuple(fc.constantFrom(1, 2, 3, 4, 5, 7, 8), fc.array(hexDigit, { minLength: 8, maxLength: 8 }))
    .map(([n, d]) => `0x${d.slice(0, n).join("")}`);
  const cleanLine = fc.constantFrom("const c = COLOR.ecto;", "const n = 42;", "", "a = (a + 0x6d2b79f5) | 0;", "const s = 0x5eed;");
  const outside = fc.constantFrom(TSX, UI, "apps/web/src/components/avatar/three-host.ts", "apps/web/src/components/avatar/Avatar.tsx");
  const inside = fc.constantFrom(ENGINE, `${ENGINE_DIR}config.ts`, `${ENGINE_DIR}fx-world.ts`);

  it("reports an inserted colour on its line outside the engine, and nothing for it inside", () => {
    fc.assert(
      fc.property(fc.array(cleanLine, { maxLength: 20 }), fc.nat(), colour, outside, inside, (lines, at, lit, out, eng) => {
        expect(found(out, lines.join("\n"))).toEqual([]);
        const index = lines.length === 0 ? 0 : at % (lines.length + 1);
        const text = [...lines.slice(0, index), `const c = new THREE.Color(${lit});`, ...lines.slice(index)].join("\n");
        expect(found(out, text)).toEqual([{ line: index + 1, match: lit, kind: "hex-0x" }]);
        expect(found(eng, text)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("never reports a 0x run that is not six digits", () => {
    fc.assert(
      fc.property(notColour, outside, (lit, out) => {
        expect(found(out, `const n = ${lit};`)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
