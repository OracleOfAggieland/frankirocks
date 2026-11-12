// policyRev raise sites (brief 014, S6; design CQ 162). policyRev is the counter that cancels speech and Decks.
// Only a late control hit that changes what is said raises it: the turn route's late hit and the Parse_Repair,
// each behind changesWhatIsSaid. No write, proposal, the repair's hardRule route or the extraction backstop does.
// Wave B (brief 026, tasks 48 and 49) adds one designed site: the turn route's own company, quiet or alone hit,
// also behind changesWhatIsSaid (design "Audience effects in the transaction"). Brief 035 (finding 1) adds the late
// narrowing in audience-swap.ts, behind narrowsAudience: a company or quiet hit the Parse_Repair commits.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SCAN_ROOTS } from "./clock-check.mjs";

/** `policyRev` followed, in the same expression, by `+ 1`, `+= 1` or `++`. */
const RAISE = /policyRev(?:\s*\+=\s*1|\s*\+\+|\s*\+\s*1\b)/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/[\\/]testing[\\/]/.test(path)) out.push(path);
  }
  return out;
}

function raiseSites(): { file: string; line: number; text: string }[] {
  const sites: { file: string; line: number; text: string }[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of sources(join(REPO_ROOT, root))) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((text, i) => {
        const code = text.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        if (RAISE.test(code)) sites.push({ file: relative(REPO_ROOT, file).replace(/\\/g, "/"), line: i + 1, text: text.trim() });
      });
    }
  }
  return sites;
}

describe("policyRev raise sites", () => {
  it("matches the raise forms and skips other counters", () => {
    expect(RAISE.test("policyRev: e.policyRev + 1")).toBe(true);
    expect(RAISE.test("doc.policyRev += 1")).toBe(true);
    expect(RAISE.test("policyRev++")).toBe(true);
    expect(RAISE.test("rulesRev: e.rulesRev + 1")).toBe(false);
    expect(RAISE.test("policyRev: env.policyRev")).toBe(false);
    expect(RAISE.test("policyRev + 10")).toBe(false);
  });

  it("raises policyRev only in the turn route's late hit, its wave B audience hit, the Parse_Repair and the late narrowing, each behind its check", () => {
    const sites = raiseSites();
    expect(sites.map((s) => s.file).sort(), sites.map((s) => `${s.file}:${s.line}: ${s.text}`).join("\n")).toEqual(["packages/server/src/audience-swap.ts", "packages/server/src/intents/repair.ts", "packages/server/src/routes/turn.ts", "packages/server/src/routes/turn.ts"]);
    for (const s of sites) {
      const before = readFileSync(join(REPO_ROOT, s.file), "utf8").split(/\r?\n/).slice(Math.max(0, s.line - 6), s.line).join("\n");
      expect(before, `${s.file}:${s.line}`).toContain(s.file.endsWith("audience-swap.ts") ? "narrowsAudience(" : "changesWhatIsSaid(");
    }
  });
});
