// Token_Check (lab-ui-foundation R2.8, R3). Scans apps/web/src/components and apps/web/src/ui for raw
// hex colours, ad hoc durations and Tailwind default palette classes. Components take every colour,
// duration and delay from the Token_Source (globals.css `@theme static`, mirrored in ui/motion.ts).
// Usage: node scripts/token-check.mjs   (prints `path:line: match` per violation, exits 1 if any)
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, toRepoPath } from "./clock-check.mjs";

export const TOKEN_SCAN_ROOTS = ["apps/web/src/components", "apps/web/src/ui"];
export const TOKEN_FILES = ["apps/web/src/app/globals.css", "apps/web/src/ui/motion.ts"];
const EXTENSIONS = [".ts", ".tsx", ".css", ".mjs"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next"]);

/** `#` plus 3 to 8 hex digits at a boundary; the length is checked separately (3, 4, 6 or 8). */
const HEX = /(?<![&\w])#([0-9a-fA-F]{3,8})(?![0-9a-zA-Z_-])/g;
const HEX_LENGTHS = new Set([3, 4, 6, 8]);

/** CSS (or style object) transition and animation declarations. */
const CSS_TIMING = /(?<![\w-])(transition|transition-duration|animation|animation-duration|animation-delay|transitionDuration|animationDuration|animationDelay)\s*:\s*([^;}\n]*)/g;
const LITERAL_TIME = /(?<![\w.-])\d*\.?\d+(ms|s)(?![\w-])/;

/** Tailwind duration and delay classes; `duration-(--x)` and `duration-[var(--x)]` pass. */
const TW_TIMING = /(?<![\w-])(duration|delay)-(\d+|\[[^\]\s]*\])/g;

/** Object keys `duration` or `delay` with a numeric literal value, in .ts and .tsx only. */
const NUMERIC_KEY = /(?<![\w$.])(duration|delay)\s*:\s*-?(\d|\.\d)/g;

/** SVG SMIL `dur` and `begin` attributes with a literal time. */
const SVG_TIMING = /(?<![\w-])(dur|begin)\s*=\s*\{?\s*["'`]\s*-?\d*\.?\d+(ms|s)?\s*["'`]/g;

const PALETTE_PREFIX = "(?:bg|text|border|ring|fill|stroke|from|to|via|shadow|outline|decoration|divide|placeholder|accent|caret)";
const PALETTE_NAMES =
  "(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)";
const PALETTE = new RegExp(
  `(?<![\\w-])${PALETTE_PREFIX}(?:-[xytrbl])?-(?:${PALETTE_NAMES}-\\d{2,3}|white|black)(?![\\w-])`,
  "g",
);

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function each(pattern, text, fn) {
  pattern.lastIndex = 0;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) fn(m);
}

/** Pure. Returns { line, match, kind } for every violation in one file's text, sorted by position. */
export function findTokenViolations(path, text) {
  const found = [];
  const add = (index, match, kind) => found.push({ index, line: lineOf(text, index), match, kind });
  const isScript = /\.(ts|tsx)$/.test(path);

  each(HEX, text, (m) => {
    if (HEX_LENGTHS.has(m[1].length)) add(m.index, m[0], "hex");
  });
  each(CSS_TIMING, text, (m) => {
    if (LITERAL_TIME.test(m[2])) add(m.index, m[0].trim(), "duration");
  });
  each(TW_TIMING, text, (m) => {
    if (m[2].startsWith("[var(--")) return;
    add(m.index, m[0], "duration");
  });
  if (isScript) each(NUMERIC_KEY, text, (m) => add(m.index, m[0], "duration"));
  each(SVG_TIMING, text, (m) => add(m.index, m[0], "duration"));
  each(PALETTE, text, (m) => add(m.index, m[0], "palette"));

  return found
    .sort((a, b) => a.index - b.index)
    .map(({ line, match, kind }) => ({ line, match, kind }));
}

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
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield join(dir, entry.name);
    }
  }
}

/** True when the Token_Check skips this repo-relative path (Token_Files and test files). */
export function isSkipped(file) {
  return TOKEN_FILES.includes(file) || /\.test\.[^/]+$/.test(file);
}

/** Scans the two UI roots under `root` and returns { file, line, match, kind } per violation. */
export function scanTokens(root = REPO_ROOT) {
  const violations = [];
  for (const scanRoot of TOKEN_SCAN_ROOTS) {
    for (const abs of walk(join(root, scanRoot))) {
      const file = toRepoPath(abs, root);
      if (isSkipped(file)) continue;
      for (const v of findTokenViolations(file, readFileSync(abs, "utf8"))) violations.push({ file, ...v });
    }
  }
  return violations;
}

export function formatTokenViolations(violations) {
  return violations.map((v) => `${v.file}:${v.line}: ${v.match}`).join("\n");
}

/** Runs the check over `root`; returns the exit code and the text to print. */
export function runTokenCheck(root = REPO_ROOT) {
  const violations = scanTokens(root);
  return { code: violations.length > 0 ? 1 : 0, output: formatTokenViolations(violations) };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { code, output } = runTokenCheck(process.argv[2] ? resolve(process.argv[2]) : REPO_ROOT);
  if (output) process.stdout.write(output + "\n");
  process.exit(code);
}
