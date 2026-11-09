// Post-build proof that the Specimens_Page did not ship (lab-ui-foundation R20.3, R20.4). Runs as the
// `postbuild` script of apps/web, so a failure makes `npm run build` exit non-zero.
//   1. No route manifest key under .next names `specimens`.
//   2. No file under .next/server or .next/static holds the Fixture sentinel.
// Usage: node scripts/specimens-absent.mjs [path/to/.next]
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, toRepoPath } from "./clock-check.mjs";

/** Built from pieces so this file never holds the sentinel itself. */
export const SENTINEL = ["SPECIMENS", "SENTINEL", "9c41"].join("_");

/** The Next 16.4.3 route manifests, relative to .next. */
export const ROUTE_MANIFESTS = ["app-path-routes-manifest.json", "server/app-paths-manifest.json"];
const OPTIONAL_MANIFESTS = ["routes-manifest.json", "prerender-manifest.json"];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Every string anywhere in a JSON value, keys included. */
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  }
  return out;
}

/** Returns a list of problems; empty means the build has no Specimens_Page. */
export function checkBuild(nextDir) {
  const problems = [];
  if (!existsSync(nextDir) || !statSync(nextDir).isDirectory()) return [`no build output at ${nextDir}`];
  for (const rel of ROUTE_MANIFESTS) {
    const file = join(nextDir, rel);
    if (!existsSync(file)) {
      problems.push(`missing route manifest ${rel}`);
      continue;
    }
    for (const key of Object.keys(JSON.parse(readFileSync(file, "utf8")))) {
      if (key.toLowerCase().includes("specimens")) problems.push(`${rel}: route ${key}`);
    }
  }
  for (const rel of OPTIONAL_MANIFESTS) {
    const file = join(nextDir, rel);
    if (!existsSync(file)) continue;
    for (const s of strings(JSON.parse(readFileSync(file, "utf8")))) {
      if (/(^|\/)specimens(\/|$|\b)/i.test(s)) {
        problems.push(`${rel}: ${s}`);
        break;
      }
    }
  }
  for (const dir of ["server", "static"]) {
    for (const file of walk(join(nextDir, dir))) {
      if (readFileSync(file, "latin1").includes(SENTINEL)) problems.push(`${toRepoPath(file)}: Fixture sentinel`);
    }
  }
  return problems;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const nextDir = process.argv[2] ? resolve(process.argv[2]) : join(REPO_ROOT, "apps/web/.next");
  const problems = checkBuild(nextDir);
  if (problems.length > 0) {
    process.stderr.write(`specimens-absent: the production build includes the Specimens_Page:\n${problems.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("specimens-absent: no Specimens_Page in the build.\n");
}
