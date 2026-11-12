// Machine index check tests (brief 014, task A1). The checker is scripts/machines-index.mjs; these run it on the
// repo and on small fixture trees, one break at a time.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";
import {
  arrivedPlanned,
  diagramStates,
  exportsName,
  exportsStepFunction,
  formatProblems,
  machineProblems,
  namedPaths,
  unionMembers,
} from "./machines-index.mjs";

describe("machine index", () => {
  it("agrees with its pages and the code", () => {
    expect(formatProblems(machineProblems(REPO_ROOT))).toBe("");
    // A planned row whose file has arrived is not an error, so the branch that adds the file stays green; it is listed.
    const arrived = arrivedPlanned(REPO_ROOT);
    if (arrived.length > 0) console.warn(`planned rows whose home file exists: ${arrived.map((r) => r.name).join(", ")}`);
  });

  it("reads a diagram's states and a union's members", () => {
    expect([...diagramStates("stateDiagram-v2\n  [*] --> A\n  A --> B : go\n  C\n  note right of C : x")].sort()).toEqual(["A", "B", "C"]);
    expect([...(unionMembers('export type P =\n  | "A"\n  /** c "Z" */\n  | "B";', "P") ?? [])]).toEqual(["A", "B"]);
    expect([...(unionMembers('export type P =\n  | "A" // was "Z"\n  | "B";', "P") ?? [])]).toEqual(["A", "B"]);
    expect([...(unionMembers('const S = { a: 1, status: oneOf(["x", "y"]) }', "S.status") ?? [])]).toEqual(["x", "y"]);
    expect([...(unionMembers('const S = { kind: oneOf(["k"]), status: oneOf(["x", "y"]) }', "S.status") ?? [])]).toEqual(["x", "y"]);
    expect(exportsName("export function step(", "step")).toBe(true);
    expect(exportsName("function step(", "step")).toBe(false);
  });

  it("reads the paths a page names, and a fence does not shift them", () => {
    const page = "`docs/a.md`\n```mermaid\nstateDiagram-v2\n  A --> B\n```\nsee `packages/x/y.ts` and `fn`";
    expect(namedPaths(page)).toEqual(["docs/a.md", "packages/x/y.ts"]);
    expect(namedPaths("```ts\nconst p = `packages/in/fence.ts`;\n```\n`docs/b.md`")).toEqual(["docs/b.md"]);
  });

  it("finds an exported step function in each of its forms", () => {
    for (const src of [
      "export function nextThing(s) {}",
      "export async function step(s) {}",
      "export function* nextThing() {}",
      "export const pollStep = (s) => s;",
      "export const tickStep = function (s) { return s; };",
      "export const tickStep: Step = async (s) => s;",
      "function step(s) {}\nexport { step };",
      "function run(s) {}\nexport { run as nextRun };",
    ]) {
      expect(exportsStepFunction(src), src).toBe(true);
    }
    for (const src of ["export const stepper = (s) => s;", "export function stepper() {}", 'export { step } from "./machine";', "function step() {}"]) {
      expect(exportsStepFunction(src), src).toBe(false);
    }
  });
});

const INDEX = [
  "# Machine index",
  "",
  "| Machine | Status | What it alone decides | Home file | Page |",
  "|---|---|---|---|---|",
  "| `demo.call` | explicit | What the call does | `packages/core/src/demo/machine.ts` | [demo](demo.md) |",
  "| `demo.doc` | documented | Where a record is | `packages/core/src/demo/doc.ts` | [demo](demo.md) |",
  "| `demo.later` | planned | Not written yet | `packages/core/src/demo/later.ts` | [demo](demo.md) |",
  "",
].join("\n");

const PAGE = [
  "# Demo",
  "",
  "### `demo.call`",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | explicit |",
  "| File | `packages/core/src/demo/machine.ts` |",
  "| Decides | `step` |",
  "| State | `DemoState` |",
  "| States | `DemoPhase` |",
  "| Tests | `packages/core/src/demo/machine.test.ts` |",
  "",
  "```mermaid",
  "stateDiagram-v2",
  "  [*] --> Idle",
  "  Idle --> Busy : go",
  "  Busy --> Idle : done",
  "```",
  "",
  "### `demo.doc`",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | documented |",
  "| File | `packages/core/src/demo/doc.ts` |",
  "| State | `DocRecord`, `DocKind` in `packages/core/src/demo/kinds.ts` |",
  "",
  "### `demo.later`",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | planned |",
  "| File | `packages/core/src/demo/later.ts` |",
  "",
].join("\n");

const CLEAN: Record<string, string> = {
  "docs/machines/README.md": INDEX,
  "docs/machines/demo.md": PAGE,
  "packages/core/src/demo/machine.ts": 'export type DemoPhase = "Idle" | "Busy";\nexport interface DemoState { phase: DemoPhase }\nexport function step(s: DemoState): DemoState { return s; }\n',
  "packages/core/src/demo/machine.test.ts": "// test\n",
  "packages/core/src/demo/doc.ts": "export interface DocRecord { id: string }\n",
  "packages/core/src/demo/kinds.ts": 'export type DocKind = "a" | "b";\n',
};

describe("machine index checker on fixture trees", () => {
  let root: string | null = null;
  afterEach(() => {
    if (root !== null) rmSync(root, { recursive: true, force: true });
    root = null;
  });
  const tree = (edits: Record<string, string | null> = {}) => {
    root = mkdtempSync(join(tmpdir(), "machines-index-"));
    for (const [path, text] of Object.entries({ ...CLEAN, ...edits })) {
      if (text === null) continue;
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  };
  const problems = (edits: Record<string, string | null> = {}) => formatProblems(machineProblems(tree(edits))).split("\n").filter((l) => l !== "");
  const page = (from: string, to: string) => {
    expect(PAGE).toContain(from);
    return { "docs/machines/demo.md": PAGE.replace(from, to) };
  };

  it("finds nothing on the clean tree", () => {
    expect(problems()).toEqual([]);
  });

  it("reports a page whose File names a file that does not exist", () => {
    expect(problems(page("| File | `packages/core/src/demo/machine.ts` |", "| File | `packages/core/src/demo/gone.ts` |"))).toEqual([
      "docs/machines/README.md demo.call: home file packages/core/src/demo/machine.ts but the page says `packages/core/src/demo/gone.ts`",
      "docs/machines/demo.md: names packages/core/src/demo/gone.ts, which does not exist",
    ]);
  });

  it("reports a Decides name the home file does not export", () => {
    expect(problems(page("| Decides | `step` |", "| Decides | `nope` |"))).toEqual([
      "docs/machines/demo.md demo.call: Decides: packages/core/src/demo/machine.ts does not export nope",
    ]);
  });

  it("reports a State type a documented block names that does not exist, in its file or the file the cell names", () => {
    expect(problems(page("`DocRecord`, `DocKind`", "`DocRecordz`, `DocKindz`"))).toEqual([
      "docs/machines/demo.md demo.doc: State: packages/core/src/demo/doc.ts or packages/core/src/demo/kinds.ts does not export DocRecordz",
      "docs/machines/demo.md demo.doc: State: packages/core/src/demo/doc.ts or packages/core/src/demo/kinds.ts does not export DocKindz",
    ]);
  });

  it("reports a diagram that lacks a state of its union", () => {
    const src = CLEAN["packages/core/src/demo/machine.ts"]!.replace('"Idle" | "Busy"', '"Idle" | "Busy" | "Done"');
    expect(problems({ "packages/core/src/demo/machine.ts": src })).toEqual(["docs/machines/demo.md demo.call: diagram lacks states Done"]);
  });

  it("reports a *-phase.ts file and an exported step function that no row names", () => {
    expect(
      problems({
        "packages/core/src/demo/x-phase.ts": "export const a = 1;\n",
        "apps/web/src/poll.ts": "export function nextPoll() {}\n",
        "packages/core/src/demo/testing/gen-phase.ts": "export function step() {}\n",
      }),
    ).toEqual([
      "apps/web/src/poll.ts: looks like a machine but no index row names it as its home file",
      "packages/core/src/demo/x-phase.ts: looks like a machine but no index row names it as its home file",
    ]);
  });

  it("reports a Tests file that does not exist", () => {
    expect(problems({ "packages/core/src/demo/machine.test.ts": null })).toEqual([
      "docs/machines/demo.md demo.call: test packages/core/src/demo/machine.test.ts does not exist",
      "docs/machines/demo.md: names packages/core/src/demo/machine.test.ts, which does not exist",
    ]);
  });

  it("does not require the home file of a planned row, and does once the row is documented", () => {
    expect(problems()).toEqual([]);
    const documented = {
      "docs/machines/README.md": INDEX.replace("| `demo.later` | planned |", "| `demo.later` | documented |"),
      ...page("| Status | planned |", "| Status | documented |"),
    };
    expect(problems(documented)).toEqual([
      "docs/machines/README.md demo.later: home file packages/core/src/demo/later.ts does not exist",
      "docs/machines/README.md: names packages/core/src/demo/later.ts, which does not exist",
      "docs/machines/demo.md: names packages/core/src/demo/later.ts, which does not exist",
    ]);
  });

  it("still checks what a planned block names once its file exists, and lists the row as arrived", () => {
    const edits = {
      "packages/core/src/demo/later.ts": "export const a = 1;\n",
      ...page("| File | `packages/core/src/demo/later.ts` |", "| File | `packages/core/src/demo/later.ts` |\n| Decides | `nope` |"),
    };
    expect(problems(edits)).toEqual(["docs/machines/demo.md demo.later: Decides: packages/core/src/demo/later.ts does not export nope"]);
    expect(arrivedPlanned(root!).map((r) => r.name)).toEqual(["demo.later"]);
  });

  it("reports an unknown status, and a table line that does not parse as a row", () => {
    expect(problems({ "docs/machines/README.md": INDEX.replace("| `demo.doc` | documented |", "| `demo.doc` | sketched |") })).toContain(
      'docs/machines/README.md demo.doc: unknown status "sketched"',
    );
    const bad = INDEX.replace("| `demo.doc` |", "| `demo_doc` |");
    expect(problems({ "docs/machines/README.md": bad })).toContain("docs/machines/README.md: 3 table lines but 2 rows parse");
  });

  it("reports a second block with the same name, whichever page it is on", () => {
    const dup = "### `demo.doc`\n\n| Field | Value |\n|---|---|\n| Status | documented |\n| File | `packages/core/src/demo/machine.ts` |\n";
    expect(problems({ "docs/machines/aaa.md": `# A\n\n${dup}` })).toEqual(["docs/machines demo.doc: one name, 2 blocks: aaa.md, demo.md"]);
    expect(problems({ "docs/machines/zzz.md": `# Z\n\n${dup}` })).toEqual(["docs/machines demo.doc: one name, 2 blocks: demo.md, zzz.md"]);
  });

  it("reports a file a State cell names that does not exist", () => {
    expect(problems({ "packages/core/src/demo/kinds.ts": null })).toEqual([
      "docs/machines/demo.md demo.doc: State: packages/core/src/demo/kinds.ts does not exist",
      "docs/machines/demo.md demo.doc: State: packages/core/src/demo/doc.ts or packages/core/src/demo/kinds.ts does not export DocKind",
      "docs/machines/demo.md: names packages/core/src/demo/kinds.ts, which does not exist",
    ]);
  });
});
