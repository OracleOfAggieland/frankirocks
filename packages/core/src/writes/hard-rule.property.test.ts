// Feature: voice-writes (brief 012), Property 4: Allergies fail closed, pure (design section 7, 2.5, 2.6, 6.2, 6.3,
// G3, G4). On a hardRule trigger, the outcome is one of: a rule written or kept, the filter written or kept, a pending
// rule resolved, a denial recorded, or `notAllergy` with both checks passed. Never nothing. Through `validateItems`
// then `planHardRule`, as the executor calls them:
//   - `rulesRev` rises by one exactly when `allergies` or `noneConfirmed` changed; when neither changed, the outcome is
//     `ruleKept`, `pendingKept` (its rules still present), `denialRecorded` (with a ledger decision citing the turn's
//     Evidence) or `notAllergy`;
//   - `notAllergy` only with a valid answer whose `need` is `none` and whose allergy items are all hypothetical, no
//     question asked, an RX4 cue that is `allerg…` or `intoleran…`, no gazetteer alias in the cue sentences and no
//     generic object within six words of a cue;
//   - no active rule is removed; a pending rule leaves `core/rules` only on a speaker-certain turn that activated a
//     rule or carried a `deny` verdict; `noneConfirmed` gains a subject only on a speaker-certain turn; no `deny`
//     verdict exists on an uncertain turn;
//   - on a turn with an RX4 match or a hardRule candidate, or an answering turn with an allergy verdict, every alias
//     found in the cue sentences (not inside a longer found alias) has its code in a slot of `core/rules`, in a `deny`
//     verdict, or in a ledger decision of a denial;
//   - on a turn triggered only by the asked question with no allergy verdict, `core/rules` is unchanged.
// The route file of design section 7 (B `routes/turn.fail-closed`) adds the store and `handled`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { REGEX_TABLE, normalizeForRegex } from "../intents/regex";
import { planHardRule } from "./hard-rule";
import { TURN_AT, TURN_EID, buildEvidence, hardRuleTurn, validateContext, verified } from "./testing/arb-writes";
import { hardRuleTurnArb } from "./testing/arb-hard-rule";
import { ORACLE_GAZETTEER, hasWholeWords, oracleNormal } from "./testing/gazetteer-oracle";
import type { ItemVerdict } from "./types";
import { validateItems } from "./validate";

const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;
const GENERIC = new Set(["something", "anything", "it", "that", "this", "these", "those", "stuff", "food", "foods", "ingredient", "ingredients", "dish", "dishes", "meal", "meals", "sauce", "medicine", "medication", "medications", "meds", "pill", "pills", "drug", "drugs", "plant", "plants", "animal", "animals"]);
const COMPOUND = new Set(["pill", "pills", "meds", "medicine", "medication", "shot", "shots", "tablet", "tablets", "spray"]);

/** Sentences split at . ! ? ; and line breaks. */
function sentences(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || ".!?;\n".includes(text[i]!)) {
      if (i > start) out.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  return out;
}

/** Codes named in `text`, an alias inside a longer found alias left out. Never `none`. */
function oracleCodes(text: string): Set<string> {
  const found: { code: string; alias: string }[] = [];
  for (const [code, e] of Object.entries(ORACLE_GAZETTEER)) {
    if (code === "none") continue;
    for (const alias of e.aliases) if (hasWholeWords(text, alias)) found.push({ code, alias });
  }
  const kept = found.filter((f) => !found.some((g) => g.alias.length > f.alias.length && hasWholeWords(g.alias, f.alias)));
  return new Set(kept.map((f) => f.code));
}

const words = (s: string) => oracleNormal(s).match(/[\p{L}\p{N}']+/gu) ?? [];

/** The code's half of G3, written out again over the cue sentences. */
function codeSaysNotAllergy(cues: readonly string[]): boolean {
  if (cues.length === 0) return false;
  for (const s of cues) {
    if (oracleCodes(s).size > 0) return false;
    const w = words(s);
    const cueAt = w.flatMap((x, i) => (RX4.test(x) ? [i] : []));
    if (cueAt.length === 0) return false;
    for (const i of cueAt) {
      if (!/^(allerg|intoleran)/.test(w[i]!)) return false;
      for (let j = Math.max(0, i - 6); j <= Math.min(w.length - 1, i + 6); j++) {
        if (j === i || !GENERIC.has(w[j]!)) continue;
        if (j === i + 1 && /^allerg(y|ies)$/.test(w[i]!) && COMPOUND.has(w[j]!)) continue;
        return false;
      }
    }
  }
  return true;
}

const denyCodes = (verdicts: readonly ItemVerdict[]): string[] =>
  verdicts.flatMap((v) => (v.kind === "allergy" && v.v.kind === "deny" && "codes" in v.v ? v.v.codes : []));

describe("Property 4: allergies fail closed (pure)", () => {
  it("every hardRule turn ends in a rule, a filter, a resolution, a denial or a checked notAllergy, never nothing", () => {
    const seen = { changed: 0, kept: 0, notAllergy: 0, covered: 0 };
    fc.assert(
      fc.property(hardRuleTurnArb, (g) => {
        const evidence = buildEvidence(TURN_EID, g.text, [], ["U"], TURN_AT);
        const regex = RX4.test(normalizeForRegex(g.text));
        const trigger = { regex, candidate: g.candidate, asked: g.answering !== null };
        fc.pre(trigger.regex || trigger.candidate || trigger.asked);

        const ctx = validateContext(evidence, { routes: new Set(["hardRule"]), speakerCertain: g.speakerCertain, answering: g.answering });
        const verdicts = g.out === null ? [] : validateItems(g.out, ctx);
        const before = g.rules;
        const plan = planHardRule(before, verdicts, hardRuleTurn(evidence, g.out, { trigger, speakerCertain: g.speakerCertain, answering: g.answering }));
        const after = plan.rules;

        const changed = JSON.stringify(after.allergies) !== JSON.stringify(before.allergies) || JSON.stringify(after.noneConfirmed) !== JSON.stringify(before.noneConfirmed);
        expect(after.rulesRev, "rulesRev rises exactly on a change").toBe(before.rulesRev + (changed ? 1 : 0));
        const allergyVerdicts = verdicts.filter((v) => v.kind === "allergy");

        if (!changed) {
          seen.kept++;
          expect(["ruleKept", "pendingKept", "denialRecorded", "notAllergy"], `outcome ${plan.outcome.kind} with nothing written`).toContain(plan.outcome.kind);
          if (plan.outcome.kind === "denialRecorded") expect(plan.ledger.some((d) => d.eid === TURN_EID)).toBe(true);
          if (plan.outcome.kind === "ruleKept" || plan.outcome.kind === "pendingKept") {
            for (const id of plan.outcome.ruleIds) expect(after.allergies.some((r) => r.id === id), `kept rule ${id}`).toBe(true);
          }
        } else seen.changed++;

        // Cue sentences, by the design's own reading (2.5).
        const all = sentences(g.text);
        const rx = all.filter((s) => RX4.test(normalizeForRegex(s.text)));
        const itemSpans = g.out === null ? [] : g.out.items.flatMap((it) => (it.kind === "allergy" ? [verified(it.span, evidence)].filter((s) => s !== null) : []));
        const cues =
          g.answering !== null
            ? [g.text]
            : rx.length > 0
              ? rx.map((s) => s.text)
              : g.out !== null
                ? all.filter((s) => itemSpans.some((sp) => sp!.start < s.end && s.start < sp!.end)).map((s) => s.text)
                : [g.text];

        if (plan.outcome.kind === "notAllergy") {
          seen.notAllergy++;
          expect(g.answering, "notAllergy while a question is asked").toBeNull();
          expect(g.out, "notAllergy without a valid answer").not.toBeNull();
          expect(g.out!.need).toBe("none");
          for (const it of g.out!.items) if (it.kind === "allergy") expect(it.act, "notAllergy with an allergy item").toBe("hypothetical");
          expect(codeSaysNotAllergy(rx.map((s) => s.text)), `notAllergy but the code check fails on "${g.text}"`).toBe(true);
        }

        // No active rule removed; a pending rule leaves only on a certain turn that activated or denied.
        const activeAfter = new Set(after.allergies.filter((r) => r.state === "active").map((r) => r.id));
        for (const r of before.allergies.filter((r) => r.state === "active")) expect(activeAfter.has(r.id), `active ${r.code} removed`).toBe(true);
        const gainedActive = after.allergies.some((r) => r.state === "active" && !before.allergies.some((b) => b.id === r.id && b.state === "active"));
        const denied = allergyVerdicts.some((v) => v.kind === "allergy" && v.v.kind === "deny");
        for (const r of before.allergies.filter((r) => r.state === "pending")) {
          if (after.allergies.some((a) => a.id === r.id)) continue;
          expect(g.speakerCertain && (gainedActive || denied), `pending ${r.code} for ${r.subjectId} left on an uncertain or plain turn`).toBe(true);
        }
        for (const s of after.noneConfirmed) if (!before.noneConfirmed.includes(s)) expect(g.speakerCertain, `noneConfirmed gained ${s}`).toBe(true);
        if (!g.speakerCertain) expect(denied, "a deny verdict on an uncertain turn").toBe(false);

        // Coverage.
        const askedOnly = !trigger.regex && !trigger.candidate;
        if (askedOnly && allergyVerdicts.length === 0) {
          expect(after, "an asked-only turn with no allergy verdict").toEqual(before);
          return;
        }
        if (!askedOnly || allergyVerdicts.length > 0) {
          const slotCodes = new Set(after.allergies.map((r) => r.code));
          const denials = new Set([...denyCodes(verdicts), ...plan.ledger.flatMap((d) => d.codes)]);
          for (const s of cues) {
            for (const code of oracleCodes(s)) {
              seen.covered++;
              expect(slotCodes.has(code) || denials.has(code), `"${s}" names ${code}, which no slot or denial holds`).toBe(true);
            }
          }
        }
      }),
      { numRuns: 500 },
    );
    expect(seen.changed).toBeGreaterThan(0);
    expect(seen.kept).toBeGreaterThan(0);
    expect(seen.covered).toBeGreaterThan(0);
  });
});
