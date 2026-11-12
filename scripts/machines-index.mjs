// Machine index check (brief 014, task A1): docs/machines/README.md and its pages against the code.
// Shared by scripts/machines-index.test.ts and scripts/state-machines-steering.test.ts.
//   - every index row has exactly one block, on its page, with the same status and home file, and every block has a row;
//   - every file a page or the index names exists, except the home files of `planned` rows;
//   - the functions and types a block names in Decides, State and Events are exported by its file (or by a file the
//     same cell names), and the tests it lists exist; an `explicit`, `table` or `view` block must name both;
//   - a block's `States` union equals the states of the diagram that follows it;
//   - every source file named `*-phase.ts` or `*machine*.ts`, or exporting a function `step`, `*Step` or `next*`,
//     is the home file of some row (files under `testing/` and test files are not machines).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const MACHINES_DIR = "docs/machines";
export const STATUSES = ["explicit", "table", "view", "documented", "planned"];
/** Statuses whose block must name its deciding function and its tests. */
export const CHECKED = ["explicit", "table", "view"];

/**
 * @typedef {{ name: string, status: string, file: string, page: string }} IndexRow
 * @typedef {{ name: string, page: string, fields: Map<string, string>, diagram: Set<string> | null }} Block
 * @typedef {{ where: string, what: string }} Problem
 */

/** The backticked items of a markdown cell. @param {string} cell @returns {string[]} */
export const ticks = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** @param {string} line @returns {string[]} */
const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** The lines of the index table: they start with "| `" and link a page. @param {string} text @returns {string[]} */
export function indexTableLines(text) {
  return text.split(/\r?\n/).filter((line) => line.startsWith("| `") && /\]\([^)]+\)/.test(line));
}

/**
 * The rows of the index table: a first cell that is a backticked `area.thing` name.
 * @param {string} text
 * @returns {IndexRow[]}
 */
export function parseIndex(text) {
  const rows = [];
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

/**
 * The states named in a mermaid stateDiagram-v2 body. `[*]` is not a state; a one-line `note ... : text` never
 * matches a state form.
 * @param {string} body
 * @returns {Set<string>}
 */
export function diagramStates(body) {
  const states = new Set();
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("stateDiagram") || line.startsWith("%%")) continue;
    const edge = /^(\[\*\]|[A-Za-z_]\w*)\s*-->\s*(\[\*\]|[A-Za-z_]\w*)/.exec(line);
    if (edge !== null) {
      for (const s of [edge[1], edge[2]]) if (s !== "[*]") states.add(s);
      continue;
    }
    const decl = /^(?:state\s+)?([A-Za-z_]\w*)\s*(?::.*)?$/.exec(line);
    if (decl !== null) states.add(decl[1]);
  }
  return states;
}

/**
 * The machine blocks of a page: a `### \`name\`` heading and its `| Field | Value |` rows.
 * @param {string} page
 * @param {string} text
 * @returns {Block[]}
 */
export function parseBlocks(page, text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^###\s+`([^`]+)`\s*$/.exec(lines[i]);
    if (head === null) continue;
    const fields = new Map();
    /** @type {Set<string> | null} */
    let diagram = null;
    // The block's own table is the first table after the heading; later tables in the section are prose.
    let table = "before";
    for (let j = i + 1; j < lines.length && !/^#{1,3}\s/.test(lines[j]); j++) {
      const line = lines[j];
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
    blocks.push({ name: head[1], page, fields, diagram });
  }
  return blocks;
}

/** @param {string} s */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when `source` exports `name` (a declaration or a name in an export list).
 * @param {string} source
 * @param {string} name
 */
export function exportsName(source, name) {
  const id = escape(name);
  const decl = new RegExp(`export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|abstract\\s+class|interface|type|enum)\\s+${id}\\b`);
  const list = new RegExp(`export\\s*(?:type\\s*)?\\{[^}]*\\b${id}\\b[^}]*\\}`);
  return decl.test(source) || list.test(source);
}

/** Strips block and line comments. @param {string} s */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/**
 * The string members of a union named in a `States` cell: `TypeName` is an exported string-literal type alias;
 * `Shape.field` is the first `field: oneOf([...])` after `const Shape`. Null when it cannot be found.
 * @param {string} source
 * @param {string} ref
 * @returns {Set<string> | null}
 */
export function unionMembers(source, ref) {
  const dotted = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(ref);
  if (dotted !== null) {
    const at = source.search(new RegExp(`\\bconst\\s+${dotted[1]}\\b`));
    if (at < 0) return null;
    const m = new RegExp(`\\b${dotted[2]}:\\s*oneOf\\(\\[([^\\]]*)\\]`).exec(source.slice(at));
    return m === null ? null : new Set([...stripComments(m[1]).matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  }
  const m = new RegExp(`export\\s+type\\s+${escape(ref)}\\s*=([^;]*);`).exec(source);
  if (m === null) return null;
  return new Set([...stripComments(m[1]).matchAll(/"([^"]+)"/g)].map((x) => x[1]));
}

/**
 * Repo paths written in backticks on a page: they start at a top-level folder and have a file part.
 * @param {string} text
 * @returns {string[]}
 */
export function namedPaths(text) {
  const out = [];
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

export const SOURCE_ROOTS = ["apps", "packages", "functions"];
/** Build output and dependencies, and `testing/` folders, whose generators and views exist only for tests. */
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".turbo", "out", "testing"]);
const MACHINE_NAME = String.raw`(?:step|[A-Za-z_]\w*Step|next[A-Z]\w*)`;
const IS_MACHINE_NAME = new RegExp(`^${MACHINE_NAME}$`);
const MACHINE_DECL = new RegExp(
  [
    String.raw`export\s+(?:async\s+)?function\s*\*?\s*${MACHINE_NAME}\s*[(<]`,
    String.raw`export\s+const\s+${MACHINE_NAME}\s*(?::[^=]*)?=\s*(?:async\s*)?(?:\(|function\b)`,
  ].join("|"),
);

/**
 * True when `source` exports a function named `step`, `*Step` or `next*`: as a declaration, a `const` arrow or
 * function expression, or a local name in an `export { ... }` list (re-exports with `from` are not counted).
 * @param {string} source
 */
export function exportsStepFunction(source) {
  if (MACHINE_DECL.test(source)) return true;
  for (const m of source.matchAll(/export\s*\{([^}]*)\}(\s*from\b)?/g)) {
    if (m[2] !== undefined) continue;
    for (const item of m[1].split(",")) {
      const exported = item.trim().split(/\s+as\s+/).pop()?.trim() ?? "";
      if (IS_MACHINE_NAME.test(exported)) return true;
    }
  }
  return false;
}

/**
 * Source files that look like machine homes, by name or by an exported step function.
 * @param {string} root
 * @returns {string[]}
 */
export function machineLikeFiles(root) {
  const found = [];
  /** @param {string} rel */
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(e.name) || /\.test\.tsx?$/.test(e.name) || e.name.endsWith(".d.ts")) continue;
      const byName = /-phase\.tsx?$/.test(e.name) || /machine[^/]*\.tsx?$/.test(e.name);
      if (byName || exportsStepFunction(readFileSync(join(root, path), "utf8"))) found.push(path);
    }
  };
  for (const r of SOURCE_ROOTS) if (existsSync(join(root, r))) walk(r);
  return found.sort();
}

/**
 * Every disagreement between the index, the pages and the code under `root`.
 * @param {string} root
 * @returns {Problem[]}
 */
export function machineProblems(root) {
  /** @type {Problem[]} */
  const problems = [];
  /** @param {string} where @param {string} what */
  const add = (where, what) => problems.push({ where, what });
  /** @param {string} rel */
  const read = (rel) => readFileSync(join(root, rel), "utf8");
  /** @param {string} rel */
  const exists = (rel) => existsSync(join(root, rel));
  const indexPath = `${MACHINES_DIR}/README.md`;
  const indexText = read(indexPath);
  const rows = parseIndex(indexText);
  if (rows.length === 0) add(indexPath, "no index rows");
  const tableLines = indexTableLines(indexText);
  if (tableLines.length !== rows.length) add(indexPath, `${tableLines.length} table lines but ${rows.length} rows parse`);

  const pages = readdirSync(join(root, MACHINES_DIR))
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();
  const blocks = pages.flatMap((p) => parseBlocks(p, read(`${MACHINES_DIR}/${p}`)));
  const planned = new Set(rows.filter((r) => r.status === "planned").map((r) => r.file));

  /** @type {Map<string, string[]>} */
  const blockPages = new Map();
  for (const block of blocks) blockPages.set(block.name, [...(blockPages.get(block.name) ?? []), block.page]);
  for (const [name, on] of blockPages) if (on.length > 1) add(`${MACHINES_DIR} ${name}`, `one name, ${on.length} blocks: ${on.join(", ")}`);

  const seen = new Set();
  for (const row of rows) {
    const where = `${indexPath} ${row.name}`;
    if (seen.has(row.name)) add(where, "duplicate row");
    seen.add(row.name);
    if (!STATUSES.includes(row.status)) add(where, `unknown status "${row.status}"`);
    if (row.file === "") add(where, "no home file");
    else if (row.status !== "planned" && !exists(row.file)) add(where, `home file ${row.file} does not exist`);
    if (!pages.includes(row.page)) {
      add(where, `page ${row.page || "(none)"} does not exist`);
      continue;
    }
    const block = blocks.find((b) => b.name === row.name && b.page === row.page);
    if (block === undefined) add(where, `no block on ${row.page}`);
    else {
      if (block.fields.get("Status") !== row.status) add(where, `status "${row.status}" but the page says "${block.fields.get("Status")}"`);
      if (ticks(block.fields.get("File") ?? "")[0] !== row.file) add(where, `home file ${row.file} but the page says ${block.fields.get("File")}`);
    }
  }

  for (const block of blocks) {
    const where = `${MACHINES_DIR}/${block.page} ${block.name}`;
    if (!seen.has(block.name)) add(where, "block has no index row");
    const status = block.fields.get("Status") ?? "";
    const file = ticks(block.fields.get("File") ?? "")[0] ?? "";
    // A planned block's file may not exist yet; when it does, whatever the block names is still checked.
    if (file === "" || !exists(file)) continue; // reported on the row, unless planned
    const source = read(file);
    for (const key of ["Decides", "State", "Events"]) {
      const items = ticks(block.fields.get(key) ?? "");
      const paths = items.filter((i) => i.includes("/"));
      for (const p of paths) if (!exists(p)) add(where, `${key}: ${p} does not exist`);
      // A name is looked up in the home file and in any file the same cell names (`X` in `path`).
      const sources = [source, ...paths.filter(exists).map(read)];
      for (const name of items.filter((i) => !i.includes("/"))) {
        if (!sources.some((s) => exportsName(s, name))) add(where, `${key}: ${[file, ...paths].join(" or ")} does not export ${name}`);
      }
    }
    if (CHECKED.includes(status)) {
      if (ticks(block.fields.get("Decides") ?? "").length === 0) add(where, "no Decides function");
      if (ticks(block.fields.get("Tests") ?? "").length === 0) add(where, "no Tests");
    }
    for (const t of ticks(block.fields.get("Tests") ?? "")) if (!exists(t)) add(where, `test ${t} does not exist`);
    const statesCell = block.fields.get("States");
    if (statesCell !== undefined) {
      const [ref, from] = ticks(statesCell);
      const members = ref === undefined ? null : unionMembers(from !== undefined && exists(from) ? read(from) : source, ref);
      if (members === null) add(where, `States: cannot find the union ${ref ?? "(none)"}`);
      else if (block.diagram === null) add(where, "States names a union but no stateDiagram-v2 follows");
      else {
        const diagram = block.diagram;
        const missing = [...members].filter((m) => !diagram.has(m));
        const extra = [...diagram].filter((d) => !members.has(d));
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

/**
 * The `planned` rows whose home file exists under `root`: their file has arrived and the row can move on.
 * @param {string} root
 * @returns {IndexRow[]}
 */
export function arrivedPlanned(root) {
  const rows = parseIndex(readFileSync(join(root, MACHINES_DIR, "README.md"), "utf8"));
  return rows.filter((r) => r.status === "planned" && r.file !== "" && existsSync(join(root, r.file)));
}

/** @param {readonly Problem[]} ps */
export const formatProblems = (ps) => ps.map((p) => `${p.where}: ${p.what}`).join("\n");
