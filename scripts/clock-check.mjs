// Static wall-clock check (R2.7–R2.9). Shared by scripts/clock-guard.test.ts and the Guard_Hook.
// The patterns are built from pieces so this file's own source never matches them.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const DATE = "Date";
/** `Date.now(` anywhere, including comments and strings. */
export const DATE_NOW_TEXT = DATE + ".now(";
const DATE_NOW = new RegExp(DATE + "\\.now\\(", "g");
/** `new Date()` with an empty argument list only; `new Date(x)` formats a supplied time and passes. */
const NEW_DATE_EMPTY = new RegExp("new\\s+" + DATE + "\\s*\\(\\s*\\)", "g");

export const SCAN_ROOTS = ["packages/core", "packages/server", "apps/web/src", "functions/src"];
const SCAN_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next"]);

/** Normalizes a path to repo-relative POSIX form. */
export function toRepoPath(path, root = REPO_ROOT) {
  const rel = /^[a-zA-Z]:[\\/]|^\//.test(path) ? relative(root, path) : path;
  return rel.split(sep).join("/").replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Reads the shared Clock_Port allow-list (R2.1). */
export function loadAllowList(root = REPO_ROOT) {
  const parsed = JSON.parse(readFileSync(join(root, "scripts", "clock-allowlist.json"), "utf8"));
  const files = parsed.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > 5 || !files.every((f) => typeof f === "string")) {
    throw new Error("scripts/clock-allowlist.json must list 1 to 5 file paths");
  }
  return files.map((f) => toRepoPath(f, root));
}

/** True when the text contains `Date.now(` (the Guard_Hook test, R2.2). */
export function containsDateNow(text) {
  return typeof text === "string" && text.includes(DATE_NOW_TEXT);
}

/** Returns every wall-clock read in `text` as { line, match }, 1-based lines. */
export function findClockViolations(text) {
  const found = [];
  for (const pattern of [DATE_NOW, NEW_DATE_EMPTY]) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      const line = text.slice(0, m.index).split("\n").length;
      found.push({ line, match: m[0] });
    }
  }
  return found.sort((a, b) => a.line - b.line);
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
    } else if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield join(dir, entry.name);
    }
  }
}

/** Scans the repo (R2.7) and returns { file, line, match } for each violation outside the allow-list. */
export function scanRepo(root = REPO_ROOT) {
  const allow = new Set(loadAllowList(root));
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const abs of walk(join(root, scanRoot))) {
      const file = toRepoPath(abs, root);
      if (allow.has(file)) continue;
      for (const v of findClockViolations(readFileSync(abs, "utf8"))) violations.push({ file, ...v });
    }
  }
  return violations;
}

/** One line per violation: `path:line: match`. */
export function formatViolations(violations) {
  return violations.map((v) => `${v.file}:${v.line}: ${v.match}`).join("\n");
}
