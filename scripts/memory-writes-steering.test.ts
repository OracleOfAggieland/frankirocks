// Memory-write steering check (brief 012 task A1): the steering file's front matter, its file pattern, its length,
// and a source citation on every rule.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";

const STEERING = readFileSync(join(REPO_ROOT, ".kiro/steering/memory-writes.md"), "utf8");
const PATTERN =
  "{packages/core/src/writes/**,packages/core/src/extract.ts,packages/core/src/intents/**,packages/core/src/head.ts,packages/server/src/onturn/**,packages/server/src/worker/extract.ts,packages/server/src/routes/turn.ts,packages/server/src/routes/receipt.ts}";

/** A citation: a spec or contracts section, a contract row, or a design gap, question, section or property. */
const CITATION = /\((?:[^()]*?)(spec §\d+|contracts §\d+|KC\d\d|KV\d\d|design (?:G\d+|CQ \d+|\d+(?:\.\d+)?|P\d+|section \d+))/;

describe("memory-writes steering file", () => {
  const lines = STEERING.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

  it("has fileMatch front matter over the extraction, intents, rules and turn-route files", () => {
    expect(lines[0]).toBe("---");
    const end = lines.indexOf("---", 1);
    expect(end).toBeGreaterThan(0);
    const front = lines.slice(1, end);
    expect(front).toContain("inclusion: fileMatch");
    expect(front).toContain(`fileMatchPattern: "${PATTERN}"`);
  });

  it("is under 80 lines including front matter", () => {
    expect(lines.length).toBeLessThan(80);
  });

  it("names its sources and says the source wins", () => {
    expect(STEERING).toContain("docs/design/memory-spec-v3.md");
    expect(STEERING).toContain("docs/design/memory-contracts-v2.md");
    expect(STEERING).toMatch(/source wins/);
  });

  it("cites a source on every rule", () => {
    const rules = lines.filter((l) => l.startsWith("- "));
    expect(rules.length).toBeGreaterThanOrEqual(11);
    for (const r of rules) expect(r, r).toMatch(CITATION);
  });

  it("states the six rules of the brief and the five the design adds", () => {
    for (const phrase of [
      "marks the old value `wrong`",
      "classes T and M) never writes a rule, a preference, an identity or `life`",
      "only from the owner's own direct words",
      "removed only by a trusted tap",
      "unresolved allergy fails closed",
      "Code validates spans, authority, subject, value and gazetteer",
      "Nothing is called saved",
      "answers `ready`",
      "A route note is an S0 pointer",
      "A denial needs a certain speaker",
      "Extraction skips only what",
      "An earlier turn never closes a later one",
      "the extraction backstop raises `policyRev`",
    ]) {
      expect(STEERING, phrase).toContain(phrase);
    }
  });
});
