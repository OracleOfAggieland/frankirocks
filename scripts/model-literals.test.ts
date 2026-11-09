import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";
import { findModelLiterals, modelConfigValues, scanModelLiterals } from "./model-literals.mjs";

const yaml = readFileSync(join(REPO_ROOT, "apps", "web", "apphosting.yaml"), "utf8");

describe("model-ID literal check", () => {
  it("reads every Model_Config value from apphosting.yaml", () => {
    const values = modelConfigValues(yaml);
    expect(values).toHaveLength(7);
    expect(values).not.toContain("frankirocks");
  });

  it("flags configured IDs and OpenAI prefixes in any quote style", () => {
    const configured = modelConfigValues(yaml);
    const sample = [`const a = "${configured[0]}";`, "const b = 'gpt-anything';", "const c = `whisper-1`;", 'const d = "text-embedding-x";'].join("\n");
    expect(findModelLiterals(sample, configured).map((v) => v.line)).toEqual([1, 2, 3, 4]);
  });

  it("ignores names, other strings and identifiers", () => {
    const sample = 'const v = "FRANKI_VOICE_MODEL"; const s = "my-gpt-thing"; const gpt = 1;';
    expect(findModelLiterals(sample, modelConfigValues(yaml))).toEqual([]);
  });

  it("no model ID literals outside config/models.ts", () => {
    const violations = scanModelLiterals();
    expect(violations, violations.map((v) => `${v.file}:${v.line}: ${v.literal}`).join("\n")).toEqual([]);
  });
});
