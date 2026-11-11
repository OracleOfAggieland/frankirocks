// WP10: the holders stay single objects (design note §3.2, review finding 7). `size`, `clock` and `targets` are made
// once in createHostPart and only mutated in place (`size.w = w`, `clock.T += dt`, `Object.assign(targets, next)`),
// because every factory destructures them from the one rig context: a reassignment would leave the other factories
// reading a stale object. The engine can't be built in node to check identity, so this scans the source text.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = dirname(fileURLToPath(import.meta.url));
const HOLDERS = ["targets", "size", "clock"] as const;

/**
 * The narrowest exceptions, each with its reason. A parameter default is a new local, not the holder: the file it
 * sits in does not destructure that holder (checked below).
 */
const ALLOWED: readonly { file: string; text: string; reason: string }[] = [
  { file: "fx-sparks.ts", text: "size = 1", reason: "emitSparks's own `size` parameter default (prototype 2255); fx-sparks has no HostPart" },
];

/** Comments out, so a sentence about a size never trips the scan. Strings stay: GLSL is code too. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Every `holder =`, `holder +=` … that is not `==`, and every `rc.holder =`, with its line. */
function assignments(text: string): { line: number; match: string }[] {
  const found: { line: number; match: string }[] = [];
  const names = HOLDERS.join("|");
  const patterns = [
    new RegExp(`(?<![\\w$.])(?:${names})\\s*(?:[-+*/%&|^]|\\*\\*|<<|>>>?|\\?\\?|&&|\\|\\|)?=(?!=)[^\\n]{0,12}`, "g"),
    new RegExp(`\\brc\\s*\\.\\s*(?:${names})\\s*(?:[-+*/%&|^]|\\*\\*|<<|>>>?|\\?\\?|&&|\\|\\|)?=(?!=)[^\\n]{0,12}`, "g"),
    new RegExp(`\\brc\\s*\\[\\s*["'\`](?:${names})["'\`]\\s*\\]\\s*=(?!=)`, "g"),
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      found.push({ line: text.slice(0, m.index).split("\n").length, match: m[0].trim() });
    }
  }
  return found;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"));

describe("the rig's holders", () => {
  it("finds the engine's files", () => {
    expect(files).toContain("context.ts");
    expect(files).toContain("loop.ts");
    expect(files.length).toBeGreaterThanOrEqual(27);
  });

  it("are never reassigned outside context.ts", () => {
    const bad: string[] = [];
    for (const file of files) {
      if (file === "context.ts") continue;
      const text = code(readFileSync(join(DIR, file), "utf8"));
      for (const a of assignments(text)) {
        if (ALLOWED.some((x) => x.file === file && a.match.startsWith(x.text))) continue;
        bad.push(`${file}:${a.line}: ${a.match}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("are never replaced through Object.assign on the rig context", () => {
    const bad: string[] = [];
    for (const file of files) {
      if (file === "context.ts") continue;
      const text = code(readFileSync(join(DIR, file), "utf8"));
      for (const m of text.matchAll(/Object\.assign\(\s*rc\s*,/g)) bad.push(`${file}:${text.slice(0, m.index).split("\n").length}`);
    }
    expect(bad).toEqual([]);
  });

  it("keeps each allowed default out of a file that destructures that holder", () => {
    for (const x of ALLOWED) {
      const holder = HOLDERS.find((h) => x.text.startsWith(h));
      expect(holder).toBeDefined();
      const text = code(readFileSync(join(DIR, x.file), "utf8"));
      const destructures = [...text.matchAll(/const\s*\{([^}]*)\}\s*=\s*rc\b/g)].some((m) => new RegExp(`(^|[\\s,])${holder}(\\s*[,:}]|\\s*$)`).test(m[1]));
      expect(destructures).toBe(false);
    }
  });

  it("catches the assignments it is meant to catch, and not comparisons or property writes", () => {
    const hits = (s: string) => assignments(s).map((a) => a.match.split(/\s/)[0]);
    expect(hits("size = { w: 1, h: 1 };")).toEqual(["size"]);
    expect(hits("clock = { T: 0 };")).toEqual(["clock"]);
    expect(hits("targets ??= next;")).toEqual(["targets"]);
    expect(hits("rc.targets = next;").length).toBeGreaterThan(0);
    expect(hits("rc['size'] = s;").length).toBeGreaterThan(0);
    expect(hits("if (size === other) x(); size.w = w; clock.T += dt; Object.assign(targets, next);")).toEqual([]);
    expect(hits("keyLight.shadow.mapSize.set(1, 1); spark.size = 2; const fontsize = 3;")).toEqual([]);
  });
});
