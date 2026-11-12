// UI boundary check (lab-ui-foundation design "Module layout", import rules 3 to 5, and R4.4).
//   Rule 3: the pure UI modules import only types, @franki/core, ui/motion.ts, ui/copy.ts and each
//           other, and never mention browser globals or a random source.
//   Rule 4: no `performance` Wall_Clock_Read in apps/web/src/components or apps/web/src/ui (the clock
//           check covers the Date forms).
//   Rule 5: nothing in apps/web/src/components/surfaces imports from apps/web/src/client.
//   No file under apps/web/src or apps/web/public references the mascot concept art.
// Patterns are built from pieces so this file's own source never matches them.
// Usage: node scripts/ui-boundaries.mjs [root]   (prints one line per violation, exits 1 if any)
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, toRepoPath } from "./clock-check.mjs";

const UI = "apps/web/src/ui/";

/** The pure modules of design "Module layout". Files not present yet are skipped. */
export const PURE_MODULES = [
  "motion.ts",
  "copy.ts",
  "avatar/types.ts",
  "avatar/look.ts",
  "avatar/events.ts",
  "avatar/acting.ts",
  "avatar/renderer-phase.ts",
  "levels/level-math.ts",
  "levels/audio-source.ts",
  "sound/score.ts",
  "sound/schedule.ts",
  "announce.ts",
  "electricity.ts",
  "electricity-budget.ts",
  "ring-spark.ts",
  "turn-copies.ts",
  "contrast.ts",
  "format-time.ts",
  "debug-flag.ts",
  "receipt-from.ts",
  "surface-props.ts",
].map((f) => UI + f);

const BROWSER_WORDS = ["window", "document", "navigator", "localStorage", "fetch", "requestAnimationFrame", "AudioContext"];
const FORBIDDEN_MENTIONS = [
  ...BROWSER_WORDS.map((w) => [w, new RegExp(`(?<![\\w$])${w}(?![\\w$])`, "g")]),
  ["Math" + ".random", new RegExp("\\bMath\\s*\\.\\s*random\\b", "g")],
];
const PERFORMANCE_NOW = new RegExp("\\bperformance\\s*\\.\\s*now\\s*\\(", "g");
const MASCOT = "mascot" + "-reference";

const STATEMENTS = [
  /\b(?:import|export)\s+(type\s+)?([^'"`;]*?)\s*\bfrom\s*(['"])([^'"\r\n]+)\3/g,
  /\bimport\s*()()(['"])([^'"\r\n]+)\3/g,
  /\bimport\s*\(\s*()()(['"`])([^'"`\r\n]+)\3/g,
  /\brequire\s*\(\s*()()(['"`])([^'"`\r\n]+)\3/g,
];

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/** Every import-like statement: { specifier, line, typeOnly }. */
export function importsOf(text) {
  const seen = new Map();
  for (const pattern of STATEMENTS) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      const at = m.index + m[0].lastIndexOf(m[4]);
      if (seen.has(at)) continue;
      const clause = (m[2] ?? "").trim();
      const named = /^\{([\s\S]*)\}$/.exec(clause);
      const allInlineTypes =
        named !== null && named[1].split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "));
      seen.set(at, { specifier: m[4], line: lineOf(text, at), typeOnly: Boolean(m[1]) || allInlineTypes });
    }
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** Resolves a relative specifier from a repo-relative file to a repo-relative module path, or null. */
export function resolveRelative(file, specifier, exists) {
  if (!specifier.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(file), specifier));
  for (const candidate of [base, base + ".ts", base + ".tsx", base + "/index.ts", base + "/index.tsx", base.replace(/\.js$/, ".ts")]) {
    if (exists(candidate)) return candidate;
  }
  return base;
}

/** Rule 3 for one pure module. */
export function checkPureModule(file, text, exists = () => true) {
  const violations = [];
  for (const { specifier, line, typeOnly } of importsOf(text)) {
    if (typeOnly) continue;
    if (specifier === "@franki/core") continue;
    const target = resolveRelative(file, specifier, exists);
    if (target !== null && PURE_MODULES.includes(target)) continue;
    violations.push({ file, line, match: specifier, rule: "pure UI module imports only types, @franki/core and other pure modules" });
  }
  for (const [word, pattern] of FORBIDDEN_MENTIONS) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      violations.push({ file, line: lineOf(text, m.index), match: word, rule: "pure UI module mentions a browser global or random source" });
    }
  }
  return violations;
}

/** Rules 4 and 5 for any non-test file under components/ or ui/. */
export function checkUiFile(file, text, exists = () => true) {
  const violations = [];
  PERFORMANCE_NOW.lastIndex = 0;
  for (let m = PERFORMANCE_NOW.exec(text); m !== null; m = PERFORMANCE_NOW.exec(text)) {
    violations.push({ file, line: lineOf(text, m.index), match: m[0], rule: "wall-clock read in components/ or ui/" });
  }
  if (file.startsWith("apps/web/src/components/surfaces/")) {
    for (const { specifier, line } of importsOf(text)) {
      const target = resolveRelative(file, specifier, exists);
      if (target !== null && target.startsWith("apps/web/src/client/")) {
        violations.push({ file, line, match: specifier, rule: "Surface imports from client/" });
      }
    }
  }
  return violations;
}

/** The mascot concept art must never be referenced from shipped code or assets. */
export function checkMascot(file, text) {
  const at = text.indexOf(MASCOT);
  return at < 0 ? [] : [{ file, line: lineOf(text, at), match: MASCOT, rule: "reference to the mascot concept art" }];
}

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

const isTest = (file) => /\.test\.[^/]+$/.test(file);
const isSource = (file) => /\.(ts|tsx|mjs|js|css)$/.test(file);

// Specimens rules (R14.3, R17.2, R20.3, R20.5), applied also to the judge spike recorder (brief 006 item 3).
const APP = "apps/web/src/app/";
export const SPECIMENS_DIR = APP + "specimens/";
export const SPECIMENS_PAGE = SPECIMENS_DIR + "page.dev.tsx";
export const RECORDER_DIR = APP + "recorder/";
/** The only files that may use the development-only `.dev.tsx` and `.dev.ts` suffixes. */
export const DEV_FILES = [SPECIMENS_PAGE, RECORDER_DIR + "page.dev.tsx", APP + "api/dev/takes/route.dev.ts"];
const DEV_DIRS = [SPECIMENS_DIR, RECORDER_DIR];
export const ENTRY_POINTS = [APP + "page.tsx", APP + "layout.tsx"];
const WORKSPACE = {
  "@franki/core": "packages/core/src/index.ts",
  "@franki/core/testing": "packages/core/src/testing/index.ts",
  "@franki/server": "packages/server/src/index.ts",
};
const CODE = /\.(ts|tsx|js|jsx|mjs)$/;

/** Resolves one import of `file` to a repo-relative code module, or null (packages, CSS, assets). */
export function resolveModule(file, specifier, exists) {
  if (Object.hasOwn(WORKSPACE, specifier)) return WORKSPACE[specifier];
  if (!specifier.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(file), specifier));
  for (const candidate of [base, ...[".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"].map((e) => base + e)]) {
    if (CODE.test(candidate) && exists(candidate)) return candidate;
  }
  return null;
}

/** Rule 2: every module reachable from the entry points, with the import that first reached it. */
export function reachable(entries, read, exists) {
  const seen = new Map();
  const queue = entries.filter(exists).map((e) => [e, null]);
  while (queue.length > 0) {
    const [file, via] = queue.shift();
    if (seen.has(file)) continue;
    seen.set(file, via);
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    for (const { specifier } of importsOf(text)) {
      const target = resolveModule(file, specifier, exists);
      if (target !== null && !seen.has(target)) queue.push([target, file]);
    }
  }
  return seen;
}

export function checkSpecimens(root = REPO_ROOT) {
  const exists = (rel) => existsSync(join(root, rel));
  const read = (rel) => readFileSync(join(root, rel), "utf8");
  const violations = [];
  for (const [file, via] of reachable(ENTRY_POINTS, read, exists)) {
    if (DEV_DIRS.some((d) => file.startsWith(d))) {
      violations.push({ file: via ?? file, line: 1, match: file, rule: "the Main_Screen reaches a development-only page module" });
    }
  }
  for (const abs of walk(join(root, "apps/web/src"))) {
    const file = toRepoPath(abs, root);
    if (/\.dev\.tsx?$/.test(file) && !DEV_FILES.includes(file)) {
      const match = file.endsWith(".dev.tsx") ? ".dev.tsx" : ".dev.ts";
      violations.push({ file, line: 1, match, rule: "only the listed development-only pages and routes may use the .dev.tsx or .dev.ts suffix" });
    }
    const home = DEV_DIRS.find((d) => file.startsWith(d));
    if (isTest(file) || !CODE.test(file)) continue;
    for (const { specifier, line } of importsOf(read(file))) {
      const target = resolveModule(file, specifier, exists);
      const into = target === null ? undefined : DEV_DIRS.find((d) => target.startsWith(d));
      if (into !== undefined && into !== home) {
        violations.push({ file, line, match: specifier, rule: into === SPECIMENS_DIR ? "imports from the Specimens_Page directory" : "imports from the recorder page directory" });
      }
    }
  }
  return violations;
}

export function scanUiBoundaries(root = REPO_ROOT) {
  const exists = (rel) => existsSync(join(root, rel));
  const read = (rel) => readFileSync(join(root, rel), "utf8");
  const violations = [];

  for (const file of PURE_MODULES) {
    if (exists(file)) violations.push(...checkPureModule(file, read(file), exists));
    else violations.push({ file, line: 0, match: file, rule: "a listed pure module does not exist" });
  }
  violations.push(...checkSpecimens(root));
  for (const dir of ["apps/web/src/components", "apps/web/src/ui"]) {
    for (const abs of walk(join(root, dir))) {
      const file = toRepoPath(abs, root);
      if (isSource(file) && !isTest(file)) violations.push(...checkUiFile(file, read(file), exists));
    }
  }
  for (const dir of ["apps/web/src", "apps/web/public"]) {
    for (const abs of walk(join(root, dir))) {
      const file = toRepoPath(abs, root);
      let text;
      try {
        text = readFileSync(abs, "latin1");
      } catch {
        continue;
      }
      violations.push(...checkMascot(file, text));
    }
  }
  return violations;
}

export function formatUiViolations(violations) {
  return violations.map((v) => `${v.file}:${v.line}: ${v.match} (${v.rule})`).join("\n");
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const violations = scanUiBoundaries(process.argv[2] ? resolve(process.argv[2]) : REPO_ROOT);
  if (violations.length > 0) process.stdout.write(formatUiViolations(violations) + "\n");
  process.exit(violations.length > 0 ? 1 : 0);
}
