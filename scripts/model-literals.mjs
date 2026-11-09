// Model-ID literal check (R30.2). No source string literal may equal a Model_Config value from
// apps/web/apphosting.yaml or start with an OpenAI model prefix. Test files and the one config module are exempt.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, toRepoPath } from "./clock-check.mjs";

export const MODEL_SCAN_ROOTS = ["apps/web/src", "packages/core", "packages/server", "functions/src", "scripts/judge-spike"];
export const MODEL_CONFIG_MODULE = "packages/server/src/config/models.ts";
const PREFIXES = ["gpt-", "text-embedding-", "whisper-"];
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next"]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Values of FRANKI_*_MODEL entries in apphosting.yaml (variable line followed by its value line). */
export function modelConfigValues(yamlText) {
  const values = [];
  const pattern = /-\s*variable:\s*(FRANKI_[A-Z0-9_]*_MODEL)\s*\r?\n\s*value:\s*["']?([^"'\s#]+)/g;
  for (let m = pattern.exec(yamlText); m !== null; m = pattern.exec(yamlText)) values.push(m[2]);
  return values;
}

/** Returns { line, literal } for every string literal in `text` that is a model ID. */
export function findModelLiterals(text, configValues) {
  const ids = new Set(configValues);
  const found = [];
  const literal = /(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1/g;
  for (let m = literal.exec(text); m !== null; m = literal.exec(text)) {
    const value = m[2];
    if (ids.has(value) || PREFIXES.some((p) => value.startsWith(p))) {
      found.push({ line: text.slice(0, m.index).split("\n").length, literal: value });
    }
  }
  return found;
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
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext)) && !TEST_FILE.test(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

/** Scans the source roots and returns { file, line, literal } for each model ID literal. */
export function scanModelLiterals(root = REPO_ROOT) {
  const configValues = modelConfigValues(readFileSync(join(root, "apps", "web", "apphosting.yaml"), "utf8"));
  const violations = [];
  for (const scanRoot of MODEL_SCAN_ROOTS) {
    for (const abs of walk(join(root, scanRoot))) {
      const file = toRepoPath(abs, root);
      if (file === MODEL_CONFIG_MODULE) continue;
      for (const v of findModelLiterals(readFileSync(abs, "utf8"), configValues)) violations.push({ file, ...v });
    }
  }
  return violations;
}
