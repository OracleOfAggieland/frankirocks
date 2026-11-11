// Feature: voice-writes (brief 012), Property 8: Lineage, at the level of the pure functions (design section 7,
// 2.5, G37; contracts §1 KC03). Every rule and every successor resolves through its span to Evidence text that
// matches. A generated turn (accents, emoji, offsets near the anchor slack) goes through `validateItems`, then
// `planHardRule`, `applyCorrection` and `applyTransition`, as the executor would call them:
//   - every rule the plan adds or changes: an active rule has a proof; a proof quotes its Evidence exactly at its
//     offsets, cites that Evidence in `dependsOn`, has root keys of that Evidence, and names its code as whole words
//     (an `unresolved` rule names none); a rule with no proof has no root keys and no dependencies;
//   - every Memory a plan writes resolves with `resolveLineage`; every new row that isn't `wrong` is rooted in this
//     turn, holds its text value inside its proof span, and depends on every input of the FastSlots packet except
//     the rows the plan closes.
// The route-level files of design section 7 (B `turn.rule-lineage`, C `turn.successor-lineage`) add the store.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Hasher, rootKey } from "../ids";
import { resolveLineage } from "../lineage";
import type { Evidence, Memory } from "../schema/records";
import { textAt } from "../text";
import { applyCorrection } from "./correction";
import { planHardRule } from "./hard-rule";
import {
  PRIOR,
  PRIOR_EID,
  TARGET_ROWS,
  TURN_AT,
  TURN_EID,
  buildEvidence,
  changeItem,
  clauseArb,
  compose,
  emptyRules,
  hardRuleTurn,
  hasher,
  itemChangeArb,
  planEnv,
  validateContext,
  verified,
} from "./testing/arb-writes";
import { codeNamedIn } from "./testing/gazetteer-oracle";
import { applyTransition } from "./transition";
import type { FastSlotsOut, Plan, PlanEnv } from "./types";
import { validateItems } from "./validate";

const turnArb = fc
  .record({
    clauses: fc.array(clauseArb, { minLength: 1, maxLength: 5 }),
    changes: fc.array(itemChangeArb.map((c) => ({ ...c, swapItem: false })), { minLength: 8, maxLength: 8 }),
    // Mostly direct, so most items reach a planner.
    direct: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
    source: fc.constantFrom<"asr" | "typed">("asr", "typed"),
  })
  .map((g) => {
    const { text, items: careful } = compose(g.clauses);
    const items = careful.slice(0, 8).map((it, i) => {
      const c = g.changes[i]!;
      return changeItem(it, { ...c, act: g.direct[i] || c.act === "direct" ? "direct" : c.act, polarity: null }, text);
    });
    return { ...g, text, items, evidence: buildEvidence(TURN_EID, text, [], ["U"], TURN_AT) };
  })
  .filter((g) => g.items.length > 0);

const keysOf = (e: Evidence, h: Hasher) => new Set(e.fieldSlices.map((s) => rootKey(s, h)));
const textOf = (e: Evidence) => (e.text !== null && e.text.kind === "inline" ? e.text.text : "");

function checkPlan(plan: Plan, env: PlanEnv, store: ReadonlyMap<string, Memory>, evidence: ReadonlyMap<string, Evidence>, label: string): number {
  if (!plan.ok) return 0;
  const puts = plan.commands.flatMap((c) => (c.op === "putMemory" ? [c] : []));
  const closed = new Set(puts.filter((c) => store.has(c.id) && store.get(c.id)!.status !== c.row.status).map((c) => c.id));
  let checked = 0;
  for (const c of puts) {
    const m = c.row;
    const r = resolveLineage({ memory: m, evidence, hasher });
    expect(r.ok, `${label}: ${m.predicate} ${m.status} lineage ${JSON.stringify(r.ok ? [] : r.failures)}`).toBe(true);
    checked++;
    if (store.has(c.id) || m.status === "wrong") continue;
    expect(m.rootSlices.some((s) => s.eid === env.proof.eid), `${label}: successor ${m.predicate} isn't rooted in this turn`).toBe(true);
    if (m.value.kind === "text") expect(env.proof.quote.toLowerCase(), `${label}: ${m.predicate} value`).toContain(m.value.text.toLowerCase());
    for (const dep of env.lineage.dependsOn) {
      const closedRow = [...closed].some((id) => dep.startsWith(`m:${id}@`));
      if (!closedRow) expect(m.dependsOn, `${label}: ${m.predicate} lacks packet input ${dep}`).toContain(dep);
    }
  }
  return checked;
}

describe("Property 8: lineage (pure)", () => {
  it("every rule and every successor resolves through its span to Evidence text that matches", () => {
    const seen = { rules: 0, rows: 0 };
    fc.assert(
      fc.property(turnArb, (g) => {
        const evidence = new Map<string, Evidence>([
          [TURN_EID, g.evidence],
          [PRIOR_EID, PRIOR],
        ]);
        const out: FastSlotsOut = { items: g.items, need: "none" };
        const ctx = validateContext(g.evidence, { source: g.source });
        const verdicts = validateItems(out, ctx);

        // Rules.
        const before = emptyRules();
        const hr = planHardRule(before, verdicts, hardRuleTurn(g.evidence, out));
        for (const r of hr.rules.allergies) {
          if (before.allergies.some((b) => JSON.stringify(b) === JSON.stringify(r))) continue;
          seen.rules++;
          if (r.state === "active") expect(r.proof, `active rule ${r.code} without a proof`).not.toBeNull();
          if (r.proof === null) {
            expect(r.rootKeys, `rule ${r.code} with no proof`).toEqual([]);
            expect(r.dependsOn, `rule ${r.code} with no proof`).toEqual([]);
            continue;
          }
          const e = evidence.get(r.proof.eid);
          expect(e, `rule ${r.code}: proof on unknown Evidence`).toBeDefined();
          expect(r.proof.start).toBeLessThan(r.proof.end);
          expect(textAt(textOf(e!), r.proof.start, r.proof.end), `rule ${r.code}: proof quote`).toBe(r.proof.quote);
          expect(r.dependsOn, `rule ${r.code}`).toContain(`e:${r.proof.eid}`);
          expect(r.rootKeys.length, `rule ${r.code}: root keys`).toBeGreaterThan(0);
          const keys = keysOf(e!, hasher);
          for (const k of r.rootKeys) expect(keys.has(k), `rule ${r.code}: root key not of its Evidence`).toBe(true);
          if (r.code !== "unresolved") expect(codeNamedIn(r.code, r.proof.quote), `rule ${r.code}: "${r.proof.quote}" names no alias of it`).toBe(true);
        }

        // Corrections and changes.
        const store = new Map<string, Memory>(TARGET_ROWS.map((m) => [m.logicalId, m]));
        for (const v of verdicts) {
          if (v.kind !== "correction" && v.kind !== "transition") continue;
          if (v.kind === "correction" && !["correct", "rename", "retract"].includes(v.v.kind)) continue;
          if (v.kind === "transition" && v.v.kind !== "change") continue;
          const proof = verified(g.items[v.index]!.span, g.evidence);
          expect(proof, `item ${v.index}: a ${v.kind} verdict on a span that doesn't verify`).not.toBeNull();
          const env = planEnv(g.evidence, TURN_EID, proof!, TARGET_ROWS);
          const plan = v.kind === "correction" ? applyCorrection(v.v, store, env) : applyTransition(v.v, store, env);
          seen.rows += checkPlan(plan, env, store, evidence, `item ${v.index} ${v.kind} ${v.v.kind}`);
        }
      }),
      { numRuns: 300 },
    );
    expect(seen.rules).toBeGreaterThan(0);
    expect(seen.rows).toBeGreaterThan(0);
  });
});
