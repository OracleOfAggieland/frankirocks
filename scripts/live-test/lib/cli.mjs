// Brief 050 part C: shared bits of the two command lines.
import { realpathSync } from "node:fs";
import { dirname, relative, resolve, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Prints one line to stderr and exits 1. */
export function fail(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(1);
}

function real(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Null when the folder may hold a run's records: outside the repo, or under the repo's `.live-test/`. Otherwise
 * the reason. Compared case-blind on Windows.
 */
export function repoFolderProblem(folder, repoRoot = REPO_ROOT, platform = process.platform) {
  const fold = (p) => (platform === "win32" ? p.toLowerCase() : p);
  const target = fold(real(folder));
  const root = fold(real(repoRoot));
  const rel = relative(root, target);
  const inside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (!inside) return null;
  const first = rel.split(/[\\/]/)[0];
  if (first === ".live-test" && rel.split(/[\\/]/).length >= 2) return null;
  return `refusing a run folder inside the repo outside .live-test${sep}: ${folder}`;
}
