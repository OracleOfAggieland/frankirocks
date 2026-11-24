#!/usr/bin/env node
// The persona check (skill persona-author; spec kiroween-demo, parts B and E).
//
//   node .kiro/skills/persona-author/scripts/check.mjs [dir]            default dir: packages/server/src/seed/kisses
//   node .kiro/skills/persona-author/scripts/check.mjs [dir] --witness  silent; appends to the persona check log
//
// What it does:
//   (a) scans the contents of the string literals in every .ts file under the folder (single-quoted, double-quoted and
//       template literals; comments and code are skipped) for Denied_List words (real names and brands), on word
//       boundaries after NFKC and case folding, and prints file:line for each hit. This is the persona's text: the
//       design's Taste property reads the fixture's string fields, not source text, so a comment or a field name
//       such as `google:` is not a hit;
//   (b) when the folder holds a *.test.ts file, runs `npx vitest run <dir>` and reports pass or fail, with the names of
//       the failing tests.
// It prints a short summary. Exit 1 on any hit or failure, 0 when clean. A folder that does not exist yet is clean:
// there is nothing to check.
//
// --witness never fails and prints nothing. It does nothing at all unless `git status --porcelain <dir>` shows a
// change; then it runs the same checks and appends one line to .kiro/specs/kiroween-demo/persona-check.log:
//   <ISO time> <PASS|FAIL> hits=<n> failing=<n>
//
// No dependency outside this repo: Node's own modules, git, and npx vitest from this repo's own install. The
// Denied_List is read as data from packages/server/src/testing/denied-words.ts (its quoted strings between the
// brackets), so no TypeScript runs to read it. The log's time is the one wall-clock reading here: this is a
// developer tool outside the app and outside the clock guard's scan roots.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const DEFAULT_DIR = "packages/server/src/seed/kisses";
const DENIED_FILE = "packages/server/src/testing/denied-words.ts";
const LOG_FILE = ".kiro/specs/kiroween-demo/persona-check.log";
const VITEST_TIMEOUT_MS = 10 * 60 * 1000;
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".git"]);

/** NFKC, case folded, every run of non-letter and non-digit characters one space. */
export function fold(s) {
  return s.normalize("NFKC").toUpperCase().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The Denied_List words from the data file, folded and deduplicated; null when the file is missing. */
export function loadDenied(root = ROOT) {
  const file = join(root, DENIED_FILE);
  if (!existsSync(file)) return null;
  const src = readFileSync(file, "utf8");
  const at = src.indexOf("export const DENIED_WORDS");
  if (at < 0) return [];
  const eq = src.indexOf("=", at);
  const open = eq < 0 ? -1 : src.indexOf("[", eq);
  const close = src.lastIndexOf("]");
  if (open < 0 || close < open) return [];
  const body = src
    .slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  const words = new Set();
  for (const m of body.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    let raw;
    try {
      raw = JSON.parse(`"${m[1]}"`);
    } catch {
      raw = m[1];
    }
    const w = fold(raw);
    if (w !== "") words.add(w);
  }
  return [...words];
}

/** Hits in one string's text: { line, word }, each word once per line. Whole words and whole phrases only. */
export function scanText(text, denied, firstLine = 1) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const folded = ` ${fold(raw)} `;
    if (folded.length <= 2) return;
    for (const w of denied) if (folded.includes(` ${w} `)) hits.push({ line: firstLine + i, word: w });
  });
  return hits;
}

const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "of", "in", "delete", "void", "throw", "new", "else", "do", "yield", "await"]);
const ESCAPES = { n: " ", r: " ", t: " ", b: " ", f: " ", v: " ", 0: " " };

/** The character an escape sequence stands for, and how far it reads; "" for a line continuation. */
function unescape(src, i) {
  const c = src[i];
  if (c === "\r" && src[i + 1] === "\n") return { text: "", len: 2, lines: 1 };
  if (c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029") return { text: "", len: 1, lines: 1 };
  if (c === "u") {
    const braced = /^\{([0-9a-fA-F]{1,6})\}/.exec(src.slice(i + 1, i + 9));
    const plain = /^[0-9a-fA-F]{4}/.exec(src.slice(i + 1, i + 5));
    const hex = braced?.[1] ?? plain?.[0];
    const cp = hex === undefined ? NaN : parseInt(hex, 16);
    if (Number.isFinite(cp) && cp <= 0x10ffff) return { text: String.fromCodePoint(cp), len: 1 + (braced ? braced[0].length : 4), lines: 0 };
  }
  if (c === "x") {
    const hex = /^[0-9a-fA-F]{2}/.exec(src.slice(i + 1, i + 3));
    if (hex) return { text: String.fromCharCode(parseInt(hex[0], 16)), len: 3, lines: 0 };
  }
  return { text: ESCAPES[c] ?? c ?? "", len: 1, lines: 0 };
}

/**
 * The contents of every string literal in TypeScript source: single-quoted, double-quoted and template literals
 * (the text parts of a template; a `${ … }` expression is code, and strings inside it are read in turn), each as
 * { text, line } where `line` is the 1-based line the text starts on. Comments, regular-expression literals and all
 * other code are skipped. A small tokenizer, not a parser: it is exact for the way persona files are written
 * (data in string literals) and fails safe on odd code by skipping it.
 */
export function stringLiterals(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let valueLike = false; // the last significant token ends an expression, so a following `/` divides
  let word = "";
  let lastWord = "";

  const endWord = () => {
    if (word !== "") lastWord = word;
    word = "";
  };

  function quoted(q) {
    const startLine = line;
    let text = "";
    i++;
    while (i < n) {
      const c = src[i];
      if (c === q) {
        i++;
        break;
      }
      if (c === "\n") break; // unterminated: stop at the line end rather than run on
      if (c === "\\") {
        const u = unescape(src, i + 1);
        text += u.text;
        line += u.lines;
        i += 1 + u.len;
        continue;
      }
      text += c;
      i++;
    }
    out.push({ text, line: startLine });
  }

  function template() {
    let text = "";
    let startLine = line;
    i++;
    while (i < n) {
      const c = src[i];
      if (c === "`") {
        i++;
        break;
      }
      if (c === "\\") {
        const u = unescape(src, i + 1);
        text += u.text;
        line += u.lines;
        i += 1 + u.len;
        continue;
      }
      if (c === "$" && src[i + 1] === "{") {
        out.push({ text, line: startLine });
        text = "";
        i += 2;
        code(true);
        startLine = line;
        continue;
      }
      if (c === "\n") line++;
      text += c;
      i++;
    }
    out.push({ text, line: startLine });
  }

  function regex() {
    let inClass = false;
    i++;
    while (i < n && src[i] !== "\n") {
      const c = src[i];
      if (c === "\\") i++;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        i++;
        break;
      }
      i++;
    }
    while (i < n && /[A-Za-z]/.test(src[i])) i++; // flags
  }

  function code(inExpression) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === "\n") {
        endWord();
        line++;
        i++;
        continue;
      }
      if (/\s/.test(c)) {
        endWord();
        i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "/") {
        endWord();
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        endWord();
        const end = src.indexOf("*/", i + 2);
        const stop = end < 0 ? n : end + 2;
        for (let k = i; k < stop; k++) if (src[k] === "\n") line++;
        i = stop;
        continue;
      }
      if (c === '"' || c === "'") {
        endWord();
        quoted(c);
        valueLike = true;
        continue;
      }
      if (c === "`") {
        endWord();
        template();
        valueLike = true;
        continue;
      }
      if (c === "/") {
        endWord();
        if (valueLike && !REGEX_AFTER_WORD.has(lastWord)) {
          i++;
          valueLike = false;
        } else {
          regex();
          valueLike = true;
        }
        lastWord = "";
        continue;
      }
      if (inExpression && c === "{") depth++;
      if (inExpression && c === "}") {
        if (depth === 0) {
          i++;
          endWord();
          return;
        }
        depth--;
      }
      if (/[A-Za-z0-9_$]/.test(c)) {
        word += c;
        valueLike = true;
        lastWord = "";
      } else {
        endWord();
        valueLike = c === ")" || c === "]" || c === "}";
        lastWord = "";
      }
      i++;
    }
  }

  code(false);
  return out;
}

/** Hits in one TypeScript file's source, read from its string literals only: { line, word }. */
export function scanSource(src, denied) {
  const hits = [];
  const seen = new Set();
  for (const lit of stringLiterals(src)) {
    for (const h of scanText(lit.text, denied, lit.line)) {
      const key = `${h.line}\u0000${h.word}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(h);
    }
  }
  return hits.sort((a, b) => a.line - b.line || (a.word < b.word ? -1 : 1));
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(p);
    } else if (e.name.endsWith(".ts")) yield p;
  }
}

const posix = (p) => p.split(sep).join("/");
const shown = (abs) => posix(relative(ROOT, abs).startsWith("..") ? abs : relative(ROOT, abs));
/** A value that is safe inside double quotes in both PowerShell's and sh's command line. */
const SAFE = /^[A-Za-z0-9_@:+=,.\/\\ -]+$/;

/** Runs vitest over the folder; { ran, failing: string[] }. Never throws. */
export function runTests(abs) {
  const files = [...walk(abs)].filter((f) => f.endsWith(".test.ts"));
  if (files.length === 0) return { ran: false, failing: [], count: 0 };
  const rel = shown(abs);
  let tmp = null;
  try {
    tmp = mkdtempSync(join(tmpdir(), "persona-check-"));
    const out = join(tmp, "report.json");
    if (!SAFE.test(rel) || !SAFE.test(out)) return { ran: true, failing: ["a path holds a character this check will not pass to a shell"], count: 1 };
    const r = spawnSync(`npx vitest run "${rel}" --reporter=json --outputFile="${out}"`, { cwd: ROOT, shell: true, encoding: "utf8", timeout: VITEST_TIMEOUT_MS });
    if (!existsSync(out)) {
      const tail = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 300);
      return { ran: true, failing: [`vitest wrote no report${tail === "" ? "" : `: ${tail}`}`], count: 1 };
    }
    const report = JSON.parse(readFileSync(out, "utf8"));
    const failing = [];
    for (const suite of report.testResults ?? []) {
      const failedCases = (suite.assertionResults ?? []).filter((a) => a.status === "failed");
      for (const a of failedCases) failing.push(a.fullName ?? a.title ?? "(unnamed test)");
      if (suite.status === "failed" && failedCases.length === 0) failing.push(`${shown(suite.name ?? abs)}: the suite did not run`);
    }
    return { ran: true, failing, count: report.numTotalTests ?? 0 };
  } catch (error) {
    return { ran: true, failing: [`the test run could not be read: ${error instanceof Error ? error.message : String(error)}`], count: 1 };
  } finally {
    if (tmp !== null) rmSync(tmp, { recursive: true, force: true });
  }
}

/** The whole check over one folder. */
export function check(abs, root = ROOT) {
  const denied = loadDenied(root);
  const hits = [];
  let scanned = 0;
  if (existsSync(abs) && statSync(abs).isDirectory() && denied !== null) {
    for (const file of walk(abs)) {
      scanned++;
      for (const h of scanSource(readFileSync(file, "utf8"), denied)) hits.push({ file: shown(file), ...h });
    }
  }
  const tests = existsSync(abs) ? runTests(abs) : { ran: false, failing: [], count: 0 };
  return { deniedMissing: denied === null, hits, scanned, tests };
}

const pass = (r) => !r.deniedMissing && r.hits.length === 0 && r.tests.failing.length === 0;

function report(r, dir) {
  const out = [];
  if (r.deniedMissing) out.push(`Denied_List not found at ${DENIED_FILE}`);
  for (const h of r.hits) out.push(`${h.file}:${h.line}: denied word "${h.word}" in a string literal`);
  for (const name of r.tests.failing) out.push(`FAILING: ${name}`);
  out.push(`persona check ${dir}: ${r.scanned} file(s) scanned, ${r.hits.length} denied word hit(s); tests ${r.tests.ran ? (r.tests.failing.length === 0 ? `PASS (${r.tests.count})` : `FAIL (${r.tests.failing.length} failing)`) : "skipped (no *.test.ts here)"}; ${pass(r) ? "PASS" : "FAIL"}`);
  return out.join("\n");
}

function changed(abs) {
  const r = spawnSync("git", ["status", "--porcelain", "--", abs], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 && (r.stdout ?? "").trim() !== "";
}

function main(argv) {
  const witness = argv.includes("--witness");
  const unknown = argv.filter((a) => a.startsWith("--") && a !== "--witness");
  const dirArg = argv.find((a) => !a.startsWith("--")) ?? DEFAULT_DIR;
  if (unknown.length > 0 && !witness) {
    process.stderr.write(`usage: node check.mjs [dir] [--witness]\nunknown option: ${unknown[0]}\n`);
    return 2;
  }
  const abs = existsSync(resolve(dirArg)) ? resolve(dirArg) : resolve(ROOT, dirArg);
  if (witness) {
    try {
      if (!existsSync(abs) || !changed(abs)) return 0;
      const r = check(abs);
      const log = join(ROOT, LOG_FILE);
      mkdirSync(dirname(log), { recursive: true });
      appendFileSync(log, `${new Date().toISOString()} ${pass(r) ? "PASS" : "FAIL"} hits=${r.hits.length} failing=${r.tests.failing.length}\n`);
    } catch {
      // A witness never fails and never speaks.
    }
    return 0;
  }
  if (!existsSync(abs)) {
    process.stdout.write(`persona check ${shown(abs)}: folder not found, nothing to check; PASS\n`);
    return 0;
  }
  const r = check(abs);
  process.stdout.write(`${report(r, shown(abs))}\n`);
  return pass(r) ? 0 : 1;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(main(process.argv.slice(2)));
