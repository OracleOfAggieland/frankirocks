// Copy check (lab-ui-foundation R17.1; UI direction principle 6). Fails when a string literal or JSX
// text in apps/web/src/components, apps/web/src/ui or the Specimens_Page directory contains a
// Banned_Cause_Word, in any letter case. Test files are skipped.
// Usage: node scripts/copy-check.mjs   (prints `path:line: match` per violation, exits 1 if any)
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, toRepoPath } from "./clock-check.mjs";

export const BANNED_CAUSE_WORDS = ["because", "caused", "thanks to", "led to", "won back"];
export const COPY_SCAN_ROOTS = ["apps/web/src/components", "apps/web/src/ui", "apps/web/src/app/specimens", "apps/web/src/app/recorder"];
const EXTENSIONS = [".ts", ".tsx", ".mjs"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next"]);

const BANNED = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${BANNED_CAUSE_WORDS.map((w) => w.replace(/ /g, "\\s+")).join("|")})(?![\\p{L}\\p{N}_])`,
  "giu",
);

/** Pure. Every Banned_Cause_Word in `text` as a whole word or phrase, any letter case: { index, match }. */
export function findBannedCauseWords(text) {
  const found = [];
  BANNED.lastIndex = 0;
  for (let m = BANNED.exec(text); m !== null; m = BANNED.exec(text)) found.push({ index: m.index, match: m[0] });
  return found;
}

/** Replaces comments with spaces (keeping line breaks) so only code, strings and JSX remain. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (c, lead) => lead + " ".repeat(c.length - lead.length));
}

/** String literals and JSX text runs in one source file, each with its start offset. */
export function extractCopy(text) {
  const code = stripComments(text);
  const pieces = [];
  for (const m of code.matchAll(/(["'`])((?:\\[\s\S]|(?!\1)[^\\\n]|(?<=`[^`]*)\n)*)\1/g)) {
    pieces.push({ index: m.index + 1, text: m[2] });
  }
  for (const m of code.matchAll(/>([^<>{}]+)</g)) pieces.push({ index: m.index + 1, text: m[1] });
  return pieces;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/** Pure. Banned words in the copy of one file: { line, match }. */
export function findCopyViolations(text) {
  const out = [];
  const seen = new Set();
  for (const piece of extractCopy(text)) {
    for (const hit of findBannedCauseWords(piece.text)) {
      const at = piece.index + hit.index;
      if (seen.has(at)) continue;
      seen.add(at);
      out.push({ at, line: lineOf(text, at), match: hit.match });
    }
  }
  return out.sort((a, b) => a.at - b.at).map(({ line, match }) => ({ line, match }));
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
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext)) && !/\.test\.[^.]+$/.test(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

export function scanCopy(root = REPO_ROOT) {
  const violations = [];
  for (const scanRoot of COPY_SCAN_ROOTS) {
    for (const abs of walk(join(root, scanRoot))) {
      const file = toRepoPath(abs, root);
      for (const v of findCopyViolations(readFileSync(abs, "utf8"))) violations.push({ file, ...v });
    }
  }
  return violations;
}

export function formatCopyViolations(violations) {
  return violations.map((v) => `${v.file}:${v.line}: ${v.match}`).join("\n");
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const violations = scanCopy(process.argv[2] ? resolve(process.argv[2]) : REPO_ROOT);
  if (violations.length > 0) process.stdout.write(formatCopyViolations(violations) + "\n");
  process.exit(violations.length > 0 ? 1 : 0);
}
