// Feature: voice-writes (brief 012), Property 4b: each pending rule leaves only for its own slot, and a hardRule turn
// never ends in nothing (design 2.4 answering rules, 2.5, 6.3; CQ 132 as narrowed by CQ 144). P4 (committed) checks
// these per turn: some rule gained, or some denial, excuses any pending rule leaving, and a `pendingKept` with no rule
// passes. This file checks them per slot, through `validateItems` then `planHardRule`, on answering turns whose
// asked rule has a proof on an earlier Evidence:
//   - on a turn with an RX4 match or a hardRule candidate, unchanged rules never come with `pendingKept` and no rule;
//   - a pending rule with a gazetteer code leaves only when an active rule for that code and a compatible subject
//     exists after the turn, or a deny verdict names its subject and code (global for its subject), or answers it
//     with no other allergen in the answer's span;
//   - an `unresolved` pending rule leaves only for a newly active food rule of its own subject (an anonymous one only
//     when it is the asked rule), or a deny verdict as above;
//   - every rule this turn wrote with a proof cites this turn in `dependsOn`;
//   - every alias in the cue sentences, outside a plain "My X" mention, has its code in a slot or a denial.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { REGEX_TABLE, normalizeForRegex } from "../intents/regex";
import { planHardRule } from "./hard-rule";
import { TURN_AT, TURN_EID, buildEvidence, hardRuleTurn, validateContext, verified } from "./testing/arb-writes";
import { answerTurnArb } from "./testing/arb-hard-rule-answers";
import { ORACLE_GAZETTEER, hasWholeWords } from "./testing/gazetteer-oracle";
import type { ItemVerdict } from "./types";
import { validateItems } from "./validate";

const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;

/** Codes named in `text` with their offsets, an alias inside a longer found alias left out. Never `none`. */
function oracleHits(text: string): { code: string; start: number; end: number }[] {
  const found: { code: string; alias: string; start: number; end: number }[] = [];
  const lower = text.toLowerCase();
  for (const [code, e] of Object.entries(ORACLE_GAZETTEER)) {
    if (code === "none") continue;
    for (const alias of e.aliases) {
      if (!hasWholeWords(text, alias)) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu");
      for (const m of lower.matchAll(re)) found.push({ code, alias, start: m.index!, end: m.index! + alias.length });
    }
  }
  return found.filter((f) => !found.some((g) => g !== f && g.start <= f.start && f.end <= g.end && g.end - g.start > f.end - f.start));
}

const codesIn = (text: string) => new Set(oracleHits(text).map((h) => h.code));
const isFood = (code: string) => ORACLE_GAZETTEER[code]?.domain === "food";

function sentences(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || ".!?;\n".includes(text[i]!)) {
      if (i > start) out.push({ start, end: i });
      start = i + 1;
    }
  }
  return out;
}

describe("Property 4b: a pending rule leaves only for its own slot; never nothing", () => {
  it("holds on answering and plain turns, whatever the asked rule and the items", () => {
    const seen = { left: 0, answered: 0, covered: 0 };
    fc.assert(
      fc.property(answerTurnArb, (g) => {
        const evidence = buildEvidence(TURN_EID, g.text, [], ["U"], TURN_AT);
        const regex = RX4.test(normalizeForRegex(g.text));
        const trigger = { regex, candidate: g.candidate, asked: g.answering !== null };
        fc.pre(trigger.regex || trigger.candidate || trigger.asked);
        const ctx = validateContext(evidence, { routes: new Set(["hardRule"]), speakerCertain: g.speakerCertain, answering: g.answering });
        const verdicts: ItemVerdict[] = g.out === null ? [] : validateItems(g.out, ctx);
        const before = g.rules;
        const plan = planHardRule(before, verdicts, hardRuleTurn(evidence, g.out, { trigger, speakerCertain: g.speakerCertain, answering: g.answering }));
        const after = plan.rules;
        const R = g.answering?.rule ?? null;
        if (R !== null) seen.answered++;

        // Never nothing.
        const changed = JSON.stringify(after.allergies) !== JSON.stringify(before.allergies) || JSON.stringify(after.noneConfirmed) !== JSON.stringify(before.noneConfirmed);
        if ((trigger.regex || trigger.candidate) && !changed && plan.outcome.kind === "pendingKept") {
          expect(plan.outcome.ruleIds.length, `pendingKept with no rule on "${g.text}"`).toBeGreaterThan(0);
        }

        // Each pending rule that leaves, tied to its own slot.
        const beforeActive = new Set(before.allergies.filter((r) => r.state === "active").map((r) => r.id));
        const gained = after.allergies.filter((r) => r.state === "active" && !beforeActive.has(r.id));
        const denies = verdicts.flatMap((v) => (v.kind === "allergy" && v.v.kind === "deny" ? [{ v: v.v, item: g.out!.items[v.index]! }] : []));
        for (const r of before.allergies.filter((x) => x.state === "pending")) {
          if (after.allergies.some((a) => a.id === r.id)) continue;
          seen.left++;
          const denied = denies.some(({ v, item }) => {
            if ("answers" in v) {
              const named = codesIn(item.span.quote);
              return v.answers === r.id && [...named].every((c) => c === r.code);
            }
            if (r.anonymous || v.subject !== r.subjectId) return false;
            return v.scope === "global" || v.codes.includes(r.code);
          });
          let firmer: boolean;
          if (r.code !== "unresolved") firmer = after.allergies.some((a) => a.state === "active" && a.code === r.code && (r.anonymous || a.subjectId === r.subjectId));
          else firmer = gained.some((a) => isFood(a.code) && (r.anonymous ? R !== null && R.id === r.id : a.subjectId === r.subjectId));
          expect(firmer || denied, `pending ${r.code} for ${r.subjectId ?? "anyone"} left on "${g.text}" (asked ${R?.code ?? "none"})`).toBe(true);
        }

        // Lineage: a rule written on this turn with a proof cites the turn.
        for (const a of after.allergies) {
          if (before.allergies.some((b) => JSON.stringify(b) === JSON.stringify(a)) || a.proof === null) continue;
          expect(a.dependsOn, `rule ${a.code} written without the turn in dependsOn`).toContain(`e:${TURN_EID}`);
        }

        // Coverage, with only plain "My X" mentions left out.
        const askedOnly = !trigger.regex && !trigger.candidate;
        const allergyVerdicts = verdicts.filter((v) => v.kind === "allergy");
        if (askedOnly && allergyVerdicts.length === 0) return;
        const all = sentences(g.text);
        const rx = all.filter((s) => RX4.test(normalizeForRegex(g.text.slice(s.start, s.end))));
        const spans = g.out === null ? [] : g.out.items.flatMap((it) => (it.kind === "allergy" ? [verified(it.span, evidence)].filter((s) => s !== null) : []));
        const cues = g.answering !== null ? [{ start: 0, end: g.text.length }] : rx.length > 0 ? rx : g.out !== null ? all.filter((s) => spans.some((sp) => sp!.start < s.end && s.start < sp!.end)) : [{ start: 0, end: g.text.length }];
        const slotCodes = new Set(after.allergies.map((r) => r.code));
        const denials = new Set([...denies.flatMap(({ v }) => ("codes" in v ? v.codes : [])), ...plan.ledger.flatMap((d) => d.codes)]);
        for (const s of cues) {
          for (const hit of oracleHits(g.text.slice(s.start, s.end))) {
            const from = s.start + hit.start;
            const to = s.start + hit.end;
            if (g.plainMentions.some(([a, b]) => a <= from && to <= b)) continue;
            seen.covered++;
            expect(slotCodes.has(hit.code) || denials.has(hit.code), `"${g.text}" names ${hit.code}, which no slot or denial holds`).toBe(true);
          }
        }
      }),
      { numRuns: 1000 },
    );
    expect(seen.left).toBeGreaterThan(0);
    expect(seen.answered).toBeGreaterThan(0);
    expect(seen.covered).toBeGreaterThan(0);
  });
});
