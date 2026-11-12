import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evidenceFieldText } from "../evidence";
import { Block, CORE_DOCS, Effect, Evidence, Memory, Overlay } from "../schema/records";
import { type Schema, validate } from "../schema/v";
import { testId } from "../testing/samples";
import { type InstallWrite, installPages, planInstall } from "./install";
import { EID_A, evidenceOf, forgetHasher, forgetStoreArb, memoryOn } from "./testing/arb-forget";

const SCHEMA: Record<InstallWrite["collection"], Schema<unknown>> = {
  blocks: Block,
  overlays: Overlay,
  memories: Memory,
  effects: Effect,
  evidence: Evidence,
  core: CORE_DOCS.rules,
};

describe("planInstall (spec §8 step 5)", () => {
  it("writes only records that pass their closed schemas, in order, paged at 50", () => {
    fc.assert(
      fc.property(forgetStoreArb, (st) => {
        const plan = planInstall(st.input);
        for (const w of plan.writes) {
          const r = validate(SCHEMA[w.collection], w.doc);
          expect(r.ok, `${w.collection}/${w.id}: ${r.ok ? "" : `${r.path} ${r.message}`}`).toBe(true);
        }
        const orders = plan.writes.map((w) => w.order);
        expect(orders).toEqual([...orders].sort());
        const pages = installPages(plan.writes);
        expect(pages.flat()).toEqual(plan.writes);
        for (const p of pages) {
          expect(p.length).toBeLessThanOrEqual(50);
          expect(new Set(p.map((w) => w.order)).size).toBe(1);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("forgetting Danny keeps the shellfish rule, re-anchored on the sanitized turn", () => {
    fc.assert(
      fc.property(forgetStoreArb, (base) => {
        const text = "I'm allergic to shellfish. Danny relapsed.";
        const danny = memoryOn(EID_A, text, 27, 42, "danny", forgetHasher);
        const evidence = new Map(base.input.evidence).set(EID_A, evidenceOf(EID_A, text, forgetHasher));
        const rule = { ...base.input.rules.allergies.at(-1)!, id: testId("shell"), code: "shellfish", proof: { eid: EID_A, fieldPath: "text" as const, start: 0, end: 26, quote: "I'm allergic to shellfish." }, dependsOn: [`e:${EID_A}`] };
        const plan = planInstall({ ...base.input, targets: [{ id: testId("danny"), memory: danny }], remove: [], evidence, effects: [], rules: { ...base.input.rules, allergies: [rule] } });
        const sanitized = plan.writes.find((w) => w.collection === "evidence" && w.doc.sanitizedFrom === EID_A);
        expect(sanitized).toBeDefined();
        expect(evidenceFieldText(sanitized!.doc as Evidence, "text")).toBe("I'm allergic to shellfish.");
        const rules = plan.writes.find((w) => w.collection === "core")!.doc as { allergies: { state: string; proof: { eid: string } | null }[] };
        expect(rules.allergies[0]!.state).toBe("active");
        expect(rules.allergies[0]!.proof!.eid).toBe(sanitized!.id);
        expect(plan.retainedRuleIds).toEqual([testId("shell")]);
        expect(plan.pendingRuleIds).toEqual([]);
        expect(plan.writes.some((w) => w.collection === "memories" && w.id === testId("danny") && w.doc.status === "blocked")).toBe(true);
      }),
      { numRuns: 1 },
    );
  });

  it("clears noneConfirmed when a non-request turn was uncommitted at the fence, and never removes a rule", () => {
    fc.assert(
      fc.property(forgetStoreArb, (st) => {
        const plan = planInstall({ ...st.input, uncommittedAtFence: true });
        const rules = plan.writes.find((w) => w.collection === "core");
        expect(rules).toBeDefined();
        expect((rules!.doc as { noneConfirmed: string[] }).noneConfirmed).toEqual([]);
      }),
      { numRuns: 50 },
    );
  });
});
