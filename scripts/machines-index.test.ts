// Machine index check (brief 014, task A1): docs/machines/README.md and its pages against the code.
//   - every index row has a block on its page with the same status and home file, and every block has a row;
//   - every file a page or the index names exists, except the home files of `planned` rows;
//   - an `explicit`, `table` or `view` block's functions and types are exported by its file, and its tests exist;
//   - a block's `States` union equals the states of the diagram that follows it;
//   - every source file named `*-phase.ts` or `*machine*.ts`, or exporting a function `step`, `*Step` or `next*`,
//     is the home file of some row (files under `testing/` and test files are not machines).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";

export const MACHINES_DIR = "docs/machines";
export const STATUSES = ["explicit", "table", "view", "documented", "planned"] as const;
export type MachineStatus = (typeof STATUSES)[number];
const CHECKED: readonly string[] = ["explicit", "table", "view"];

export interface IndexRow {
  name: string;
  status: string;
  file: string;
  page: string;
}

export interface Block {
  name: string;
  page: string;
  fields: Map<string, string>;
  /** The states of the first `stateDiagram-v2` between this block and the next heading, or null. */
  diagram: Set<string> | null;
}

/** The backticked items of a markdown cell. */
export const ticks = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** The rows of the index table: a first cell that is a backticked `area.thing` name. */
export function parseIndex(text: string): IndexRow[] {
  const rows: IndexRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("| `")) continue;
    const c = cells(line);
    const name = ticks(c[0] ?? "")[0];
    if (name === undefined || !/^[a-z]+\.[A-Za-z]+$/.test(name)) continue;
    const page = /\]\(([^)]+)\)/.exec(c[4] ?? "")?.[1] ?? "";
    rows.push({ name, status: c[1] ?? "", file: ticks(c[3] ?? "")[0] ?? "", page });
  }
  return rows;
}

/** The states named in a mermaid stateDiagram-v2 body. `[*]` and notes are not states. */
export function diagramStates(body: string): Set<string> {
  const states = new Set<string>();
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("stateDiagram") || line.startsWith("note ") || line.startsWith("%%")) continue;
    const edge = /^(\[\*\]|[A-Za-z_]\w*)\s*-->\s*(\[\*\]|[A-Za-z_]\w*)/.exec(line);
    if (edge !== null) {
      for (const s of [edge[1]!, edge[2]!]) if (s !== "[*]") states.add(s);
      continue;
    }
    const decl = /^(?:state\s+)?([A-Za-z_]\w*)\s*(?::.*)?$/.exec(line);
    if (decl !== null) states.add(decl[1]!);
  }
  return states;
}

/** The machine blocks of a page: a `### \`name\`` heading and its `| Field | Value |` rows. */
export function parseBlocks(page: string, text: string): Block[] {
  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^###\s+`([^`]+)`\s*$/.exec(lines[i]!);
    if (head === null) continue;
    const fields = new Map<string, string>();
    let diagram: Set<string> | null = null;
    // The block's own table is the first table after the heading; later tables in the section are prose.
    let table: "before" | "in" | "after" = "before";
    for (let j = i + 1; j < lines.length && !/^#{1,3}\s/.test(lines[j]!); j++) {
      const line = lines[j]!;
      const isRow = line.startsWith("|");
      if (isRow && table !== "after") {
        table = "in";
        const [key, value] = cells(line);
        if (key !== undefined && value !== undefined && key !== "Field" && !/^-+$/.test(key)) fields.set(key, value);
      } else if (!isRow && table === "in") table = "after";
      if (diagram === null && line.trim() === "```mermaid" && lines[j + 1]?.trim().startsWith("stateDiagram-v2")) {
        const end = lines.findIndex((l, k) => k > j && l.trim() === "```");
        diagram = diagramStates(lines.slice(j + 1, end).join("\n"));
      }
    }
    blocks.push({ name: head[1]!, page, fields, diagram });
  }
  return blocks;
}

/** True when `source` exports `name` (a declaration or a name in an export list). */
export function exportsName(source: string, name: string): boolean {
  const id = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const decl = new RegExp(`export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|abstract\\s+class|interface|type|enum)\\s+${id}\\b`);
  const list = new RegExp(`export\\s*(?:type\\s*)?\\{[^}]*\\b${id}\\b[^}]*\\}`);
  return decl.test(source) || list.test(source);
}

/**
 * The string members of a union named in a `States` cell: `TypeName` is an exported string-literal type alias;
 * `Shape.field` is the first `field: oneOf([...])` after `const Shape`. Null when it cannot be found.
 */
export function unionMembers(source: string, ref: string): Set<string> | null {
  const dotted = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(ref);
  if (dotted !== null) {
    const at = source.search(new RegExp(`\\bconst\\s+${dotted[1]}\\b`));
    if (at < 0) return null;
    const m = new RegExp(`\\b${dotted[2]}:\\s*oneOf\\(\\[([^\\]]*)\\]`).exec(source.slice(at));
    return m === null ? null : new Set([...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!));
  }
  const m = new RegExp(`export\\s+type\\s+${ref}\\s*=([^;]*);`).exec(source);
  if (m === null) return null;
  const body = m[1]!.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  return new Set([...body.matchAll(/"([^"]+)"/g)].map((x) => x[1]!));
}

/** Repo paths written in backticks on a page: they start at a top-level folder and have a file part. */
export function namedPaths(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  // Line by line, outside fenced blocks, so a fence's backticks never pair with an inline one.
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const t of ticks(line)) {
      if (!/^(apps|packages|functions|scripts|docs|tests|\.kiro|\.github)\/[^\s*<>{}]+\.[A-Za-z0-9]+$/.test(t)) continue;
      out.push(t);
    }
  }
  return out;
}

const SOURCE_ROOTS = ["apps", "packages", "functions"];
/** Build output and dependencies, and `testing/` folders, whose generators and views exist only for tests. */
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".turbo", "out", "testing"]);
const MACHINE_NAME = String.raw`(step|[A-Za-z_]\w*Step|next[A-Z]\w*)`;
const MACHINE_EXPORT = new RegExp(
  String.raw`export\s+(?:async\s+)?function\s+${MACHINE_NAME}\s*[(<]|export\s+const\s+${MACHINE_NAME}\s*(?::[^=]*)?=\s*(?:async\s*)?\(`,
);

/** Source files that look like machine homes, by name or by an exported step function. */
export function machineLikeFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(e.name) || /\.test\.tsx?$/.test(e.name) || e.name.endsWith(".d.ts")) continue;
      const byName = /-phase\.tsx?$/.test(e.name) || /machine[^/]*\.tsx?$/.test(e.name);
      if (byName || MACHINE_EXPORT.test(readFileSync(join(root, path), "utf8"))) found.push(path);
    }
  };
  for (const r of SOURCE_ROOTS) if (existsSync(join(root, r))) walk(r);
  return found.sort();
}

export interface Problem {
  where: string;
  what: string;
}

/** Every disagreement between the index, the pages and the code under `root`. */
export function machineProblems(root: string): Problem[] {
  const problems: Problem[] = [];
  const add = (where: string, what: string) => problems.push({ where, what });
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");
  const indexPath = `${MACHINES_DIR}/README.md`;
  const indexText = read(indexPath);
  const rows = parseIndex(indexText);
  if (rows.length === 0) add(indexPath, "no index rows");

  const pages = readdirSync(join(root, MACHINES_DIR)).filter((f) => f.endsWith(".md") && f !== "README.md");
  const blocks = pages.flatMap((p) => parseBlocks(p, read(`${MACHINES_DIR}/${p}`)));
  const planned = new Set(rows.filter((r) => r.status === "planned").map((r) => r.file));
  const exists = (rel: string) => existsSync(join(root, rel));

  const seen = new Set<string>();
  for (const row of rows) {
    const where = `${indexPath} ${row.name}`;
    if (seen.has(row.name)) add(where, "duplicate row");
    seen.add(row.name);
    if (!(STATUSES as readonly string[]).includes(row.status)) add(where, `unknown status "${row.status}"`);
    if (row.file === "") add(where, "no home file");
    else if (row.status !== "planned" && !exists(row.file)) add(where, `home file ${row.file} does not exist`);
    if (!pages.includes(row.page)) {
      add(where, `page ${row.page || "(none)"} does not exist`);
      continue;
    }
    const block = blocks.find((b) => b.name === row.name);
    if (block === undefined || block.page !== row.page) add(where, `no block on ${row.page}`);
    else {
      if (block.fields.get("Status") !== row.status) add(where, `status "${row.status}" but the page says "${block.fields.get("Status")}"`);
      if (ticks(block.fields.get("File") ?? "")[0] !== row.file) add(where, `home file ${row.file} but the page says ${block.fields.get("File")}`);
    }
  }

  for (const block of blocks) {
    const where = `${MACHINES_DIR}/${block.page} ${block.name}`;
    if (!seen.has(block.name)) add(where, "block has no index row");
    const status = block.fields.get("Status") ?? "";
    if (status === "planned") continue;
    const file = ticks(block.fields.get("File") ?? "")[0] ?? "";
    if (file === "" || !exists(file)) continue; // reported on the row
    const source = read(file);
    if (CHECKED.includes(status)) {
      for (const key of ["Decides", "State", "Events"]) {
        for (const item of ticks(block.fields.get(key) ?? "")) {
          if (item.includes("/")) {
            if (!exists(item)) add(where, `${key}: ${item} does not exist`);
          } else if (!exportsName(source, item)) add(where, `${key}: ${file} does not export ${item}`);
        }
      }
      if (ticks(block.fields.get("Decides") ?? "").length === 0) add(where, "no Decides function");
      const tests = ticks(block.fields.get("Tests") ?? "");
      if (tests.length === 0) add(where, "no Tests");
    }
    for (const t of ticks(block.fields.get("Tests") ?? "")) if (!exists(t)) add(where, `test ${t} does not exist`);
    const statesCell = block.fields.get("States");
    if (statesCell !== undefined) {
      const [ref, from] = ticks(statesCell);
      const members = ref === undefined ? null : unionMembers(from !== undefined && exists(from) ? read(from) : source, ref);
      if (members === null) add(where, `States: cannot find the union ${ref ?? "(none)"}`);
      else if (block.diagram === null) add(where, "States names a union but no stateDiagram-v2 follows");
      else {
        const missing = [...members].filter((m) => !block.diagram!.has(m));
        const extra = [...block.diagram].filter((d) => !members.has(d));
        if (missing.length > 0) add(where, `diagram lacks states ${missing.join(", ")}`);
        if (extra.length > 0) add(where, `diagram has states ${extra.join(", ")} that ${ref} does not`);
      }
    }
  }

  for (const rel of [indexPath, ...pages.map((p) => `${MACHINES_DIR}/${p}`)]) {
    for (const path of namedPaths(read(rel))) if (!planned.has(path) && !exists(path)) add(rel, `names ${path}, which does not exist`);
  }

  const homes = new Set(rows.map((r) => r.file));
  for (const file of machineLikeFiles(root)) if (!homes.has(file)) add(file, `looks like a machine but no index row names it as its home file`);
  return problems;
}

const format = (ps: readonly Problem[]) => ps.map((p) => `${p.where}: ${p.what}`).join("\n");

describe("machine index", () => {
  it("agrees with its pages and the code", () => {
    expect(format(machineProblems(REPO_ROOT))).toBe("");
  });

  it("does not require the home file of a planned row", () => {
    const rows = parseIndex(readFileSync(join(REPO_ROOT, MACHINES_DIR, "README.md"), "utf8"));
    expect(rows.some((r) => r.status === "planned")).toBe(true);
    for (const r of rows) expect(STATUSES as readonly string[]).toContain(r.status);
  });

  it("reads a diagram's states and a union's members", () => {
    expect([...diagramStates("stateDiagram-v2\n  [*] --> A\n  A --> B : go\n  C\n  note right of C : x")].sort()).toEqual(["A", "B", "C"]);
    expect([...(unionMembers('export type P =\n  | "A"\n  /** c "Z" */\n  | "B";', "P") ?? [])]).toEqual(["A", "B"]);
    expect([...(unionMembers('const S = { a: 1, status: oneOf(["x", "y"]) }', "S.status") ?? [])]).toEqual(["x", "y"]);
    expect(exportsName("export function step(", "step")).toBe(true);
    expect(exportsName("function step(", "step")).toBe(false);
  });

  it("reads the paths a page names, and a fence does not shift them", () => {
    const page = "`docs/a.md`\n```mermaid\nstateDiagram-v2\n  A --> B\n```\nsee `packages/x/y.ts` and `fn`";
    expect(namedPaths(page)).toEqual(["docs/a.md", "packages/x/y.ts"]);
  });
});
