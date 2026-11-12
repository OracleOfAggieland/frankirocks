// policyRev raise sites (brief 014, S6; design CQ 162). policyRev is the counter that cancels speech and Decks.
// Only a control hit that changes what is said raises it. No write, proposal, the repair's hardRule route or the
// extraction backstop does. Brief 035 names every site by the function it is in, with the check it sits behind:
//   - the Superseding_Post's late hit (postSupersede) and the Parse_Repair's (repairTx), behind
//     changesWhatIsSaid(..., "A"), and only when no narrowing raised it already;
//   - wave B on the turn (audienceEffect), behind audienceRow: the Server_Rule's outcome is an audience row (rows 6
//     to 10, or row 7 with company), not merely a parse that changesWhatIsSaid in wave B, which crisis and forget
//     also pass (design "Audience effects in the transaction");
//   - a late company or quiet hit (lateNarrowing), behind narrowsAudience.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SCAN_ROOTS } from "./clock-check.mjs";
import { type CoreBundle, type CoreEpoch, type CoreRules, type RuleInput, serverRule } from "@franki/core";
import { audienceEffect } from "../packages/server/src/audience-swap";

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

/** The name of the function a line sits in: the nearest `function name(` at or above it. */
function enclosing(lines: readonly string[], i: number): string {
  for (let j = i; j >= 0; j--) {
    const m = /\bfunction\s+(\w+)\s*\(/.exec(lines[j]!);
    if (m !== null) return m[1]!;
  }
  return "(top level)";
}

function raiseSites(): { file: string; line: number; text: string; fn: string }[] {
  const sites: { file: string; line: number; text: string; fn: string }[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of sources(join(REPO_ROOT, root))) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((text, i) => {
        const code = text.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        if (RAISE.test(code)) sites.push({ file: relative(REPO_ROOT, file).replace(/\\/g, "/"), line: i + 1, text: text.trim(), fn: enclosing(lines, i) });
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

  it("raises policyRev only at the four named sites, each behind its own check", () => {
    const sites = raiseSites();
    const named = sites.map((s) => `${s.file} ${s.fn}`).sort();
    expect(named, sites.map((s) => `${s.file}:${s.line} (${s.fn}): ${s.text}`).join("\n")).toEqual([
      "packages/server/src/audience-swap.ts audienceEffect",
      "packages/server/src/audience-swap.ts lateNarrowing",
      "packages/server/src/intents/repair.ts repairTx",
      "packages/server/src/routes/turn.ts postSupersede",
    ]);
    const guard: Record<string, RegExp> = {
      audienceEffect: /if \(audienceRow\(o\) === null\) return null;/,
      lateNarrowing: /!narrowsAudience\(x\.parse, x\.judge\)\) return null;/,
      repairTx: /narrowing === null && changesWhatIsSaid\(slow\.parse, judge, "A"\)/,
      postSupersede: /narrowing === null && slow\.parse\.kind === "hit" && changesWhatIsSaid\(slow\.parse, judge, "A"\)/,
    };
    for (const s of sites) {
      const before = readFileSync(join(REPO_ROOT, s.file), "utf8").split(/\r?\n/).slice(Math.max(0, s.line - 6), s.line).join("\n");
      expect(before, `${s.file}:${s.line} (${s.fn})`).toMatch(guard[s.fn]!);
    }
  });

  it("the wave B site raises only for an audience outcome of the Server_Rule, and by one", () => {
    const epoch = { policyRev: 7, epoch: 1, activeSessionId: "s1", activeCallId: null } as unknown as CoreEpoch;
    const x = { sessionId: "s1", modifiers: { rushed: null, crisis: null }, epoch, bundle: {} as CoreBundle, rules: { rulesRev: 1 } as CoreRules, opsNow: 0, head: null, bundleWritten: false, hasher: { sha256: () => "h" } };
    const base: RuleInput = { source: "asr", transcript: "final", judge: "H", parse: { kind: "ordinary" }, regexMatch: false, audience: "private", narrowedHere: false, callLive: true, parseGap: false, noteSens: "none", wordsPer2s: true, allFinal: true, toolParseCommitted: false, wave: "B" };
    const hit = (p: Record<string, number>) => ({ kind: "hit" as const, chosen: Object.keys(p)[0] as never, candidates: Object.keys(p) as never[], uncertain: false, candidateP: p });
    // Crisis alone and forget alone pass changesWhatIsSaid in wave B but are no audience outcome: no raise here.
    for (const parse of [{ kind: "ordinary" } as const, hit({ crisis: 0.9 }), hit({ forget: 0.9 }), hit({ food: 0.9 })]) expect(audienceEffect(serverRule({ ...base, parse }), x), JSON.stringify(parse)).toBeNull();
    expect(audienceEffect(serverRule({ ...base, narrowedHere: true }), x)).toBeNull();
    for (const parse of [hit({ company: 0.9 }), hit({ forget: 0.9, company: 0.9 }), hit({ company: 0.9, crisis: 0.6 })]) expect(audienceEffect(serverRule({ ...base, parse }), x)?.epoch.policyRev, JSON.stringify(parse)).toBe(8);
  });
});
