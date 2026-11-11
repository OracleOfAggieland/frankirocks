// Feature: voice-writes (brief 012), Property 1: Authority, pure (design section 7; contracts §2; KC04).
// For any Evidence whose covering slices are of class T, M, O or C, and any FastSlotsV1 output whatever, nothing is
// written. Per item: an item whose span lies on a non-U slice gets only `ignored authority` (or `outOfScope`). Per
// turn: on Evidence with no U slice, every verdict is `ignored`, and `planHardRule` returns `core/rules` unchanged
// and no note (coverage and the fallback scan only U slices, design 2.5). The planners are also handed verdicts as if
// validation had passed, with a proof on T or M text, and must still plan no write (contracts §7: only U and C carry
// subject truth; C is left out of that half for that reason).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Class, type Span, msFromTs } from "../schema/primitives";
import type { CoreRules, Memory } from "../schema/records";
import { applyCorrection } from "./correction";
import { planHardRule } from "./hard-rule";
import {
  ALL_ROUTES,
  DAD,
  DAD_LIFE,
  SELF_NAME,
  SISTER,
  SISTER_REL,
  TARGET_ROWS,
  TURN_AT,
  TURN_EID,
  buildEvidence,
  changeItem,
  clauseArb,
  compose,
  emptyRules,
  exactOn,
  hardRuleTurn,
  inU,
  itemChangeArb,
  planEnv,
  routesArb,
  validateContext,
} from "./testing/arb-writes";
import { aliasesIn } from "./testing/gazetteer-oracle";
import { applyTransition } from "./transition";
import type { FastItem, FastSlotsOut, ItemVerdict, Need, Plan } from "./types";
import { validateItems } from "./validate";

const NON_U: Class[] = ["T", "M", "O", "C"];

const needArb = fc.constantFrom<Need>("none", "none", "none", "subject", "target", "meaning", "speaker", "time");

/** Prior rules: none, an anonymous `unresolved` filter, or a pending rule for the owner. */
const priorRulesArb: fc.Arbitrary<CoreRules> = fc.constantFrom("none", "anon", "self").map((k) => {
  const r = emptyRules();
  if (k === "anon") r.allergies.push({ id: "a".repeat(43), subjectId: null, code: "unresolved", state: "pending", anonymous: true, proof: null, proofRev: null, rootKeys: [], dependsOn: [] });
  if (k === "self") r.allergies.push({ id: "b".repeat(43), subjectId: "self", code: "peanut", state: "pending", anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] });
  return r;
});

/** A turn: clauses, item changes, slice layout, and the context fields validation reads. */
function turnArb(classes: fc.Arbitrary<Class>) {
  return fc
    .record({
      clauses: fc.array(clauseArb, { minLength: 1, maxLength: 5 }),
      changes: fc.array(itemChangeArb, { minLength: 8, maxLength: 8 }),
      cutFracs: fc.uniqueArray(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 4 }),
      classes: fc.array(classes, { minLength: 5, maxLength: 5 }),
      need: needArb,
      routes: fc.oneof(fc.constant(ALL_ROUTES), routesArb),
      speakerCertain: fc.boolean(),
      answering: fc.boolean(),
      rules: priorRulesArb,
    })
    .map((g) => {
      const { text, items: careful } = compose(g.clauses);
      const items = careful.slice(0, 8).map((it, i) => changeItem(it, g.changes[i]!, text));
      const cuts = [...new Set(g.cutFracs.map((f) => Math.floor(f * text.length)))].sort((a, b) => a - b);
      const evidence = buildEvidence(TURN_EID, text, cuts, g.classes, TURN_AT);
      const out: FastSlotsOut = { items, need: g.need };
      return { ...g, text, careful, items, evidence, out };
    })
    .filter((g) => g.careful.length > 0);
}

const verdictAt = (vs: readonly ItemVerdict[], i: number) => vs.find((v) => v.index === i);

/** True when a Plan writes nothing: refused, or only ledger decisions. */
const writesNothing = (p: Plan) => !p.ok || p.commands.every((c) => c.op === "ledger");

describe("Property 1: authority (pure)", () => {
  it("an item whose span lies on a non-U slice gets only ignored authority or outOfScope", () => {
    let onNonU = 0;
    fc.assert(
      fc.property(turnArb(fc.constantFrom<Class>("U", "U", "T", "M", "O", "C")), (g) => {
        const ctx = validateContext(g.evidence, { routes: g.routes, speakerCertain: g.speakerCertain, answering: g.answering ? { rule: null } : null });
        const verdicts = validateItems(g.out, ctx);
        g.items.forEach((item, i) => {
          if (!exactOn(item.span, g.text) || inU(g.evidence.fieldSlices, item.span.start, item.span.end)) return;
          onNonU++;
          const v = verdictAt(verdicts, i);
          expect(v, `no verdict for item ${i}`).toBeDefined();
          expect(v!.kind, `item ${i} (${item.kind}) on a non-U slice`).toBe("ignored");
          if (v!.kind === "ignored") expect(["authority", "outOfScope"]).toContain(v!.reason);
        });
      }),
      { numRuns: 300 },
    );
    expect(onNonU).toBeGreaterThan(0);
  });

  it("on Evidence with no U slice, every verdict is ignored and core/rules is unchanged", () => {
    fc.assert(
      fc.property(turnArb(fc.constantFrom(...NON_U)), fc.boolean(), (g, failed) => {
        const ctx = validateContext(g.evidence, { routes: g.routes, speakerCertain: g.speakerCertain, answering: g.answering ? { rule: null } : null });
        const verdicts = validateItems(g.out, ctx);
        for (const v of verdicts) expect(v.kind, `verdict ${JSON.stringify(v)}`).toBe("ignored");
        // Valid answer or a failed call: the fallback must not fire on T, M, O or C text either.
        const turn = hardRuleTurn(g.evidence, failed ? null : g.out, { speakerCertain: g.speakerCertain, answering: ctx.answering });
        const plan = planHardRule(g.rules, failed ? [] : verdicts, turn);
        expect(plan.rules).toEqual(g.rules);
        expect(plan.note).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it("the planners write nothing from a proof on T or M text, even for a verdict validation would never give", () => {
    let tried = 0;
    fc.assert(
      fc.property(turnArb(fc.constantFrom<Class>("T", "M")), (g) => {
        const rows = new Map<string, Memory>(TARGET_ROWS.map((m) => [m.logicalId, m]));
        g.careful.forEach((item: FastItem) => {
          if (!exactOn(item.span, g.text)) return;
          const proof: Span = item.span;
          const env = planEnv(g.evidence, TURN_EID, proof, TARGET_ROWS);
          if (item.kind === "allergy") {
            const code = aliasesIn(item.item)[0]?.code ?? "unresolved";
            const forged: ItemVerdict[] =
              item.polarity === "denied"
                ? [{ kind: "allergy", index: 0, v: { kind: "deny", subject: "self", scope: "specific", codes: [code], proof } }]
                : code === "unresolved"
                  ? [{ kind: "allergy", index: 0, v: { kind: "unsure", subject: "self", label: null, codes: "unresolved", question: "whatItem", proof } }]
                  : [{ kind: "allergy", index: 0, v: { kind: "affirm", subject: "self", label: null, codes: [code], proof } }];
            const plan = planHardRule(g.rules, forged, hardRuleTurn(g.evidence, { items: [item], need: "none" }));
            expect(plan.rules).toEqual(g.rules);
            tried++;
          } else if (item.kind === "correction") {
            const plan =
              item.targetIds[0] === SISTER_REL.logicalId
                ? applyCorrection({ kind: "rename", target: SISTER_REL.logicalId, entity: SISTER, from: "Maya", to: item.replacementValue?.kind === "text" ? item.replacementValue.text : "Mara" }, rows, env)
                : applyCorrection({ kind: "correct", targets: [SELF_NAME.logicalId], value: { kind: "text", text: "Alex" }, args: {} }, rows, env);
            expect(writesNothing(plan), JSON.stringify(plan)).toBe(true);
            tried++;
          } else if (item.kind === "transition") {
            const t = item.transition === "illness" ? "illness" : "death";
            const plan = applyTransition({ kind: "change", transition: t, subject: DAD, counterpart: null, when: msFromTs(TURN_AT) }, new Map([[DAD_LIFE.logicalId, DAD_LIFE]]), env);
            expect(writesNothing(plan), JSON.stringify(plan)).toBe(true);
            tried++;
          }
        });
      }),
      { numRuns: 200 },
    );
    expect(tried).toBeGreaterThan(0);
  });
});
