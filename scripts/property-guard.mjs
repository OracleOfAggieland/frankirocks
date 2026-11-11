#!/usr/bin/env node
// Property guard (voice-control R1.5–R1.8). Runs as a Kiro PreToolUse hook on agent file writes.
// Reads the hook event JSON on stdin and decides from the tool input and git's index alone: it never opens the
// target file.
//   exit 0: allowed (the target is not a *.property.test.ts file, or git does not track it yet)
//   exit 2: blocked (the target is a property test file git already tracks, staged or committed, or the write could
//   not be checked)
// The target is resolved against the repository root first, so a relative path that leaves and re-enters the
// repository (`../<repo folder>/...`) is checked like any other, and git is asked without regard to letter case, so
// a case variant of a tracked file (which names the same file on a case-insensitive file system) is blocked too.
// A tracked property is only ever changed by a person: a new property goes in a new file, and a property that
// looks wrong is a stop and a report, never an edit (voice-control R20.3, R20.5).
import { spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, toRepoPath } from "./clock-check.mjs";
import { PATH_KEYS, toolInputOf } from "./clock-guard.mjs";

const PROPERTY_FILE = /\.property\.test\.ts$/i;

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `file` names a property test file. */
export function isPropertyFile(file) {
  return PROPERTY_FILE.test(file);
}

/**
 * Whether git tracks `file` (repo-relative POSIX), staged or committed. Exit 0 of `git ls-files --error-unmatch`
 * means tracked and 1 means not tracked; anything else (no git, not a repository) throws, so the hook blocks rather
 * than guess. The `:(literal,icase)` pathspec matches the name exactly except for letter case.
 */
export function gitTracks(file, root = REPO_ROOT) {
  const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", `:(literal,icase)${file}`], { cwd: root, encoding: "utf8" });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new Error(`git ls-files failed (${r.error?.message ?? `status ${r.status}`})`);
}

/** Pure decision: returns { code, message }. `isTracked(repoPath)` answers whether git tracks the file. */
export function decide(rawStdin, isTracked) {
  let event;
  try {
    event = JSON.parse(rawStdin);
  } catch {
    return { code: 2, message: "property guard: could not parse the hook input as JSON, so the write could not be checked." };
  }
  if (!isObject(event)) {
    return { code: 2, message: "property guard: the hook input is not a JSON object, so the write could not be checked." };
  }
  const input = toolInputOf(event);
  const target = PATH_KEYS.map((k) => input[k]).find((v) => typeof v === "string" && v.trim() !== "");
  if (target === undefined) {
    return { code: 2, message: "property guard: no target file path in the tool input, so the write could not be checked." };
  }
  // Relative paths are taken from the repository root (the hook runs there), so `..` segments are resolved before
  // the outside-the-repository check below.
  const slashed = target.replace(/\\/g, "/");
  const file = toRepoPath(isAbsolute(slashed) ? slashed : resolve(REPO_ROOT, slashed));
  if (!isPropertyFile(file)) return { code: 0, message: "" };
  // A resolved path outside the repository can't be one of its tracked files.
  if (file.startsWith("../")) return { code: 0, message: "" };
  if (!isTracked(file)) return { code: 0, message: "" };
  return {
    code: 2,
    message:
      `property guard: blocked a write to ${file} because it is a property test file git has tracked (staged or committed). ` +
      "Add the new property in a new *.property.test.ts file, or stop and report: a tracked property is never edited to make it pass.",
  };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let result;
  try {
    result = decide(await readStdin(), (file) => gitTracks(file));
  } catch (error) {
    result = { code: 2, message: `property guard: the write could not be checked (${error instanceof Error ? error.message : String(error)}).` };
  }
  if (result.message) process.stderr.write(result.message + "\n");
  process.exit(result.code);
}
