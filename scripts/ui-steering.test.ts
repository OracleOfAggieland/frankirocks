// UI_Steering check (lab-ui-foundation R1.3 to R1.6): the steering file's front matter, length,
// source reference and colour tokens against docs/design/ui-direction.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";

const STEERING = readFileSync(join(REPO_ROOT, ".kiro/steering/ui-design.md"), "utf8");
const DIRECTION = readFileSync(join(REPO_ROOT, "docs/design/ui-direction.md"), "utf8");

/** Colour rows of a markdown table: | `name` | `#HEX` | … */
function colourRows(text: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const m of text.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|\s*`(#[0-9A-Fa-f]{6})`\s*\|/gm)) {
    rows.set(m[1], m[2].toUpperCase());
  }
  return rows;
}

describe("UI steering file", () => {
  const lines = STEERING.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

  it("has fileMatch front matter for apps/web/src", () => {
    expect(lines[0]).toBe("---");
    const end = lines.indexOf("---", 1);
    expect(end).toBeGreaterThan(0);
    const front = lines.slice(1, end);
    expect(front).toContain("inclusion: fileMatch");
    expect(front).toContain('fileMatchPattern: "apps/web/src/**"');
  });

  it("is at most 119 lines including front matter", () => {
    expect(lines.length).toBeLessThanOrEqual(119);
  });

  it("names the UI direction as its source", () => {
    expect(STEERING).toContain("docs/design/ui-direction.md");
    expect(STEERING).toMatch(/source wins/);
  });

  it("states every UI direction colour with the same value", () => {
    const source = colourRows(DIRECTION);
    const steering = colourRows(STEERING);
    expect(source.size).toBe(14);
    for (const [name, hex] of source) {
      expect(steering.get(name), name).toBe(hex);
    }
  });

  it("lists every Banned_Cause_Word", () => {
    for (const word of ["because", "caused", "thanks to", "led to", "won back"]) {
      expect(STEERING).toContain(`"${word}"`);
    }
  });
});
