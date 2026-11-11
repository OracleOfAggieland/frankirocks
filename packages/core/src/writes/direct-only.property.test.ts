// Feature: voice-writes (brief 012), Property 2: Only direct words write (design section 7; rows A2 to A4, C2, C3,
// T2, T3). On U Evidence, an item whose `act` isn't `direct`, or whose span doesn't match the Evidence text beyond
// the anchor slack (3), writes nothing: its verdict is `ignored` (`act` or `span`), or `careOnly` for a transition,
// so no planner is handed it. An allergy item whose `item` doesn't occur in its verified span writes nothing either.
// Turn-level coverage and the fallback (design 2.5) are P4's: here the rules they may add are anonymous pending
// filters, and no rule for a subject is added, activated or removed by such items. The converse is checked too, so
// the property can't pass by ignoring everything: a direct item with a matching span and its `item` inside it is
// never ignored for `act` or `span`. Not an answering turn: answering rule 1 fills an item from the asked rule.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planHardRule } from "./hard-rule";
import {
  ALL_ROUTES,
  TURN_AT,
  TURN_EID,
  buildEvidence,
  changeItem,
  clauseArb,
  compose,
  emptyRules,
  hardRuleTurn,
  inU,
  itemChangeArb,
  itemInQuote,
  validateContext,
  verified,
} from "./testing/arb-writes";
import type { FastItem, FastSlotsOut, ItemVerdict } from "./types";
import { validateItems } from "./validate";

const turnArb = fc
  .record({
    clauses: fc.array(clauseArb, { minLength: 1, maxLength: 5 }),
    changes: fc.array(itemChangeArb, { minLength: 8, maxLength: 8 }),
    speakerCertain: fc.boolean(),
    source: fc.constantFrom<"asr" | "typed">("asr", "typed"),
  })
  .map((g) => {
    const { text, items: careful } = compose(g.clauses);
    const items = careful.slice(0, 8).map((it, i) => changeItem(it, g.changes[i]!, text));
    const evidence = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
    return { ...g, text, items, evidence };
  })
  .filter((g) => g.items.length > 0);

/** Why an item may not write, by the property's own reading: null when it is direct and matches. */
function fault(item: FastItem, g: { evidence: Parameters<typeof verified>[1] }): "act" | "span" | "item" | null {
  const span = verified(item.span, g.evidence);
  if (span === null) return "span";
  if (item.kind === "allergy" && !itemInQuote(item.item, span.quote)) return "item";
  if (item.act !== "direct") return "act";
  return null;
}

const verdictAt = (vs: readonly ItemVerdict[], i: number) => vs.find((v) => v.index === i);

describe("Property 2: only direct words write", () => {
  it("a non-direct or mismatched item is ignored for act or span, or careOnly for a transition", () => {
    const seen = { faulty: 0, clean: 0 };
    fc.assert(
      fc.property(turnArb, (g) => {
        const ctx = validateContext(g.evidence, { speakerCertain: g.speakerCertain, source: g.source, routes: ALL_ROUTES, answering: null });
        const verdicts = validateItems({ items: g.items, need: "none" }, ctx);
        g.items.forEach((item, i) => {
          const v = verdictAt(verdicts, i);
          expect(v, `no verdict for item ${i}`).toBeDefined();
          const f = fault(item, g);
          if (f === null) {
            seen.clean++;
            // The converse: a direct, matching item is never turned away for its act or its span.
            if (v!.kind === "ignored") expect(["act", "span"], `clean item ${i} (${item.kind})`).not.toContain(v!.reason);
            return;
          }
          seen.faulty++;
          const careOnly = item.kind === "transition" && v!.kind === "transition" && v!.v.kind === "careOnly";
          // A transition with a matching span but another act is careOnly (row T3); with a bad span it is ignored (T2).
          if (careOnly) expect(f, `careOnly for a transition whose span fails`).toBe("act");
          else {
            expect(v!.kind, `item ${i} (${item.kind}, fault ${f})`).toBe("ignored");
            // Rows A1, C1 and T1 come first: a span on another eid, or past the U slice, has no U slice covering it.
            const offU = item.span.eid !== TURN_EID || !inU(g.evidence.fieldSlices, item.span.start, item.span.end);
            if (v!.kind === "ignored") expect(f === "span" && offU ? ["act", "span", "authority"] : ["act", "span"]).toContain(v!.reason);
          }
        });
      }),
      { numRuns: 300 },
    );
    expect(seen.faulty).toBeGreaterThan(0);
    expect(seen.clean).toBeGreaterThan(0);
  });

  it("from such items alone, no rule for a subject is added, activated or removed", () => {
    fc.assert(
      fc.property(turnArb, fc.boolean(), (g, withPrior) => {
        const bad = g.items.filter((item) => fault(item, g) !== null);
        fc.pre(bad.length > 0);
        const rules = emptyRules();
        if (withPrior) {
          rules.allergies.push({ id: "c".repeat(43), subjectId: "self", code: "sesame", state: "pending", anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] });
          rules.allergies.push({ id: "d".repeat(43), subjectId: "self", code: "milk", state: "active", anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] });
        }
        const out: FastSlotsOut = { items: bad, need: "none" };
        const ctx = validateContext(g.evidence, { speakerCertain: g.speakerCertain, source: g.source, answering: null });
        const verdicts = validateItems(out, ctx);
        const plan = planHardRule(rules, verdicts, hardRuleTurn(g.evidence, out, { speakerCertain: g.speakerCertain }));
        // Every prior rule is still there, in the same state.
        for (const r of rules.allergies) {
          const after = plan.rules.allergies.find((x) => x.id === r.id);
          expect(after, `rule ${r.code} for ${r.subjectId} removed`).toBeDefined();
          expect(after!.state).toBe(r.state);
        }
        // Anything new came from coverage or the fallback: anonymous and pending.
        for (const r of plan.rules.allergies) {
          if (rules.allergies.some((x) => x.id === r.id)) continue;
          expect(r.state, `new rule ${r.code}`).toBe("pending");
          expect(r.anonymous, `new rule ${r.code} has subject ${r.subjectId}`).toBe(true);
          expect(r.subjectId).toBeNull();
        }
      }),
      { numRuns: 300 },
    );
  });
});
