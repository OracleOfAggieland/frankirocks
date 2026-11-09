// Import-boundary check (R5.1–R5.3, R5.6–R5.8). Reads every non-test .ts/.tsx source file in the
// Core_Library, the Server_Library and the Browser_Client, and inspects static imports, `export ... from`,
// dynamic `import()` and `require()`. Call patterns are built from pieces so this file never matches them.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { REPO_ROOT, toRepoPath } from "./clock-check.mjs";

const NODE_IO = [
  "fs", "fs/promises", "net", "http", "https", "http2", "tls", "dns", "dgram",
  "child_process", "cluster", "worker_threads", "process", "os",
];

const startsPkg = (name) => (spec) => spec === name || spec.startsWith(name + "/");
const scope = (name) => (spec) => spec.startsWith(name + "/");

/** Forbidden specifier tests per area. Each returns a reason or null. */
const CORE_RULES = [
  ["firebase", startsPkg("firebase")],
  ["firebase-admin", startsPkg("firebase-admin")],
  ["@google-cloud/*", scope("@google-cloud")],
  ["openai", startsPkg("openai")],
  ["@openai/*", scope("@openai")],
  ["next", startsPkg("next")],
  ["Server_Library", startsPkg("@franki/server")],
  ["Web_App", startsPkg("@franki/web")],
  ["functions", startsPkg("@franki/functions")],
  ...NODE_IO.map((m) => [`node module ${m}`, (spec) => spec === m || spec === "node:" + m]),
];

const SERVER_RULES = [
  ["next", startsPkg("next")],
  ["Web_App", startsPkg("@franki/web")],
];

const BROWSER_RULES = [
  ["Server_Library", startsPkg("@franki/server")],
  ["firebase-admin", startsPkg("firebase-admin")],
  ["openai", startsPkg("openai")],
  ["@openai/*", scope("@openai")],
];

/** Route handlers run on the server, but may not reach the Admin SDK or OpenAI directly (R5.4). */
const ROUTE_RULES = [
  ["firebase-admin", startsPkg("firebase-admin")],
  ["openai", startsPkg("openai")],
  ["@openai/*", scope("@openai")],
];

/** Relative imports that land inside these directories are forbidden for the area. */
const RELATIVE_FORBIDDEN = {
  core: ["packages/server/", "apps/web/", "functions/"],
  server: ["apps/web/"],
  browser: ["packages/server/"],
  route: [],
};

const CALL_PATTERNS = [
  ["Date" + ".now()", new RegExp("\\bDate\\s*\\.\\s*now\\s*\\(", "g")],
  ["new Date" + "()", new RegExp("\\bnew\\s+Date\\s*\\(\\s*\\)", "g")],
  ["performance" + ".now()", new RegExp("\\bperformance\\s*\\.\\s*now\\s*\\(", "g")],
];

const SPECIFIER_PATTERNS = [
  /\bimport\s+(?:type\s+)?[^'"`;]*?\bfrom\s*(['"])([^'"\r\n]+)\1/g,
  /\bimport\s*(['"])([^'"\r\n]+)\1/g,
  /\bexport\s+(?:type\s+)?[^'"`;]*?\bfrom\s*(['"])([^'"\r\n]+)\1/g,
  /\bimport\s*\(\s*(['"`])([^'"`\r\n]+)\1/g,
  /\brequire\s*\(\s*(['"`])([^'"`\r\n]+)\1/g,
];

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/** Returns { specifier, line } for every import, export-from, dynamic import and require in `text`. */
export function extractSpecifiers(text) {
  const seen = new Map();
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      const at = m.index + m[0].lastIndexOf(m[2]);
      if (!seen.has(at)) seen.set(at, { specifier: m[2], line: lineOf(text, at) });
    }
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** Which area a repo-relative file belongs to, or null when it is not checked. */
export function areaOf(file) {
  if (!/\.tsx?$/.test(file) || /\.(test|spec)\.tsx?$/.test(file) || /\.d\.ts$/.test(file)) return null;
  if (file.startsWith("packages/core/src/")) return "core";
  if (file.startsWith("packages/server/src/")) return "server";
  if (file.startsWith("apps/web/src/app/api/")) return "route";
  if (file.startsWith("apps/web/src/")) return "browser";
  return null;
}

const RULES = { core: CORE_RULES, server: SERVER_RULES, browser: BROWSER_RULES, route: ROUTE_RULES };

/** Checks one file's text. Returns { file, line, specifier?, call?, rule }. */
export function checkFile(file, text, root = REPO_ROOT) {
  const area = areaOf(file);
  if (area === null) return [];
  const violations = [];
  for (const { specifier, line } of extractSpecifiers(text)) {
    for (const [rule, test] of RULES[area]) {
      if (test(specifier)) violations.push({ file, line, specifier, rule });
    }
    if (specifier.startsWith(".")) {
      const target = toRepoPath(resolve(root, dirname(file), specifier), root) + "/";
      for (const dir of RELATIVE_FORBIDDEN[area]) {
        if (target.startsWith(dir)) violations.push({ file, line, specifier, rule: `relative import into ${dir}` });
      }
    }
  }
  if (area === "core") {
    for (const [call, pattern] of CALL_PATTERNS) {
      pattern.lastIndex = 0;
      for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
        violations.push({ file, line: lineOf(text, m.index), call, rule: "wall-clock read in core" });
      }
    }
  }
  return violations;
}

const SCAN_ROOTS = ["packages/core/src", "packages/server/src", "apps/web/src"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next"]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else {
      yield join(dir, entry.name);
    }
  }
}

/** Scans the three areas and returns every violation. */
export function scanImports(root = REPO_ROOT) {
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const abs of walk(join(root, scanRoot))) {
      const file = toRepoPath(abs, root);
      if (areaOf(file) === null) continue;
      violations.push(...checkFile(file, readFileSync(abs, "utf8"), root));
    }
  }
  return violations;
}

export function formatImportViolations(violations) {
  return violations.map((v) => `${v.file}:${v.line}: ${v.specifier ?? v.call} (${v.rule})`).join("\n");
}

export const FORBIDDEN_EXAMPLES = {
  core: [
    "firebase", "firebase/app", "firebase-admin", "firebase-admin/firestore", "@google-cloud/kms",
    "openai", "openai/resources", "@openai/agents", "next", "next/server", "@franki/server", "@franki/web",
    "@franki/functions", ...NODE_IO, ...NODE_IO.map((m) => "node:" + m),
  ],
  server: ["next", "next/server", "@franki/web"],
  browser: ["@franki/server", "firebase-admin", "firebase-admin/auth", "openai", "@openai/agents"],
  route: ["firebase-admin", "firebase-admin/app", "openai", "@openai/agents"],
};
