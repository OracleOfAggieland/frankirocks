// State-machine steering check (brief 014, task A1): the steering file's front matter, length and source, and that
// its file pattern covers every home file in the machine index. Also that the voice-control steering file covers
// every file in the voice folder, so a new machine file there loads the voice rules.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";
import { indexTableLines, parseIndex } from "./machines-index.mjs";

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");
const linesOf = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

/** The front matter lines between the opening and closing `---`. */
function frontMatter(lines: readonly string[]): string[] {
  expect(lines[0]).toBe("---");
  const end = lines.indexOf("---", 1);
  expect(end).toBeGreaterThan(0);
  return lines.slice(1, end);
}

function patternOf(front: readonly string[]): string {
  const line = front.find((l) => l.startsWith("fileMatchPattern: "));
  expect(line, "fileMatchPattern line").toBeDefined();
  const m = /^fileMatchPattern: "([^"]+)"$/.exec(line!);
  expect(m, "fileMatchPattern is one quoted string").not.toBeNull();
  return m![1]!;
}

/** A glob with at most one level of `{a,b}` braces, `**` and `*`, as a whole-path RegExp. */
function globToRegExp(glob: string): RegExp {
  const alternatives = /^\{([^{}]*)\}$/.test(glob) ? glob.slice(1, -1).split(",") : [glob];
  const one = (g: string) =>
    g
      .split("**")
      .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"))
      .join(".*");
  return new RegExp(`^(?:${alternatives.map(one).join("|")})$`);
}

describe("state-machine steering file", () => {
  const text = read(".kiro/steering/state-machines.md");
  const lines = linesOf(text);
  const front = frontMatter(lines);

  it("has fileMatch front matter in the style of the other steering files", () => {
    expect(front).toHaveLength(2);
    expect(front[0]).toBe("inclusion: fileMatch");
    expect(front[1]!.startsWith('fileMatchPattern: "{')).toBe(true);
  });

  it("is under 80 lines including front matter", () => {
    expect(lines.length).toBeLessThan(80);
  });

  it("names the machine index and says to look there first", () => {
    expect(text).toContain("docs/machines/README.md");
    expect(text).toMatch(/Look in the index before adding a status field/);
    expect(text).toContain("scripts/machines-index.test.ts");
  });

  it("covers every home file in the machine index", () => {
    const pattern = globToRegExp(patternOf(front));
    const index = read("docs/machines/README.md");
    const rows = parseIndex(index);
    // The same parser as the index test, and every table line must parse, so no row is skipped unseen.
    expect(rows.length).toBe(indexTableLines(index).length);
    expect(rows.length).toBeGreaterThan(0);
    const uncovered = rows.filter((r) => !pattern.test(r.file)).map((r) => `${r.name}: ${r.file}`);
    expect(uncovered).toEqual([]);
  });

  it("names the eight rules and the four shapes, and no others", () => {
    for (const rule of ["One place", "Pure", "Closed unions", "Effects and timers are data", "An answer names its request", "Exits are listed", "Fields other code reads keep their shape", "Never throw in a transition"]) {
      expect(text).toContain(`**${rule}.**`);
    }
    for (const shape of ["Decision", "Table", "View", "Reducer"]) expect(text).toMatch(new RegExp(`^\\| ${shape} \\|`, "m"));
    expect(lines.filter((l) => /^\d+\. \*\*/.test(l))).toHaveLength(8);
    const shapes = lines.slice(lines.indexOf("## Four shapes") + 1);
    const shapeRows = shapes.slice(0, shapes.findIndex((l) => l.startsWith("## "))).filter((l) => /^\| [A-Z]/.test(l) && !l.startsWith("| Shape |"));
    expect(shapeRows).toHaveLength(4);
  });
});

describe("voice-control steering file pattern", () => {
  const pattern = globToRegExp(patternOf(frontMatter(linesOf(read(".kiro/steering/voice-control.md")))));

  it("covers every file in the voice folder, including ones not written yet", () => {
    const voice = "packages/core/src/voice";
    const files = readdirSync(join(REPO_ROOT, voice), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => relative(REPO_ROOT, join(e.parentPath, e.name)).split(sep).join("/"));
    expect(files).toContain(`${voice}/machine.ts`);
    const unseen = [`${voice}/zz-not-written.ts`, `${voice}/testing/zz-not-written.ts`, `${voice}/zz/deeper/not-written.ts`];
    const uncovered = [...files, ...unseen].filter((f) => !pattern.test(f));
    expect(uncovered).toEqual([]);
  });

  it("still covers the voice files outside that folder", () => {
    for (const f of ["packages/core/src/admission.ts", "packages/server/src/admission/seam.ts", "packages/server/src/routes/turn.ts", "apps/web/src/client/voice-client.ts"]) {
      expect(pattern.test(f), f).toBe(true);
    }
    expect(pattern.test("packages/server/src/routes/open.ts")).toBe(false);
  });
});
