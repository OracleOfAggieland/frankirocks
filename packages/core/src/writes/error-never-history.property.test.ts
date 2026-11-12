// Feature: voice-writes (brief 012), Property 5: An error never becomes history, pure (design section 7, 6.5, G24,
// G33, G35; spec §4 "a correction marks the old value wrong, never history"). After `applyCorrection` of value V on
// key K at time t, no sequence of later plans makes V current or `history` on K again. The later plans are
// corrections of the wrong row and of the current row, retractions, transitions, and renames back, each from a turn
// asserted before, at or after t (an earlier turn's job can commit after the correction). At every step:
//   - no row on K with value V is active, scheduled or history unless all its root Evidence was asserted after t;
//   - the corrected row stays `wrong`, and `statusTransition` refuses every event on it;
//   - the successor stays active unless a later U turn changed it: a plan that targets it, or a transition from a
//     turn asserted at or after it (G35: an earlier turn never closes a later row).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Value, msFromTs, tsFromMs } from "../schema/primitives";
import type { Evidence, Memory } from "../schema/records";
import { testId } from "../testing/samples";
import { applyCorrection } from "./correction";
import { statusTransition } from "./status";
import { DAD, NOW, PRIOR, PRIOR_AT, PRIOR_EID, SELF_NAME, SISTER, SISTER_REL, TURN_AT, TURN_EID, buildEvidence, planEnv, row, spanAt } from "./testing/arb-writes";
import { applyTransition } from "./transition";
import type { CorrectionVerdict, Plan } from "./types";

const HOUR = 3_600_000;
const T = msFromTs(TURN_AT);

type ShapeId = "life" | "selfName" | "rename";

interface Shape {
  id: ShapeId;
  subject: string;
  predicate: "person.life" | "identity.name";
  wrong: Value;
  right: Value;
  others: Value[];
  /** Rows the store starts with; the first one on K is the corrected row (none for a rename without a name row). */
  rows: (withNameRow: boolean) => Memory[];
  verdict: (rows: ReadonlyMap<string, Memory>) => CorrectionVerdict;
}

const enumV = (code: string): Value => ({ kind: "enum", code });
const textV = (text: string): Value => ({ kind: "text", text });

const DAD_ILL = row(testId("mdadill"), { subjectId: DAD, predicate: "person.life", value: enumV("ill"), args: { detail: null } }, PRIOR, PRIOR_EID, "My dad lives in Leeds");
const SISTER_NAME = row(testId("msistername"), { subjectId: SISTER, predicate: "identity.name", value: textV("Maya"), args: {}, entityIds: [SISTER] }, PRIOR, PRIOR_EID, "My sister Maya");

const SHAPES: Record<ShapeId, Shape> = {
  life: {
    id: "life",
    subject: DAD,
    predicate: "person.life",
    wrong: enumV("ill"),
    right: enumV("hospitalized"),
    others: [enumV("recovering"), enumV("recovered"), enumV("deceased")],
    rows: () => [DAD_ILL],
    verdict: () => ({ kind: "correct", targets: [DAD_ILL.logicalId], value: enumV("hospitalized"), args: { detail: null } }),
  },
  selfName: {
    id: "selfName",
    subject: "self",
    predicate: "identity.name",
    wrong: textV("Alec"),
    right: textV("Alex"),
    others: [textV("Al"), textV("Alexander")],
    rows: () => [SELF_NAME],
    verdict: () => ({ kind: "correct", targets: [SELF_NAME.logicalId], value: textV("Alex"), args: {} }),
  },
  rename: {
    id: "rename",
    subject: SISTER,
    predicate: "identity.name",
    wrong: textV("Maya"),
    right: textV("Mara"),
    others: [textV("May"), textV("Mia")],
    rows: (withNameRow) => (withNameRow ? [SISTER_REL, SISTER_NAME] : [SISTER_REL]),
    verdict: () => ({ kind: "rename", target: SISTER_REL.logicalId, entity: SISTER, from: "Maya", to: "Mara" }),
  },
};

const said = (v: Value) => (v.kind === "text" ? v.text : v.kind === "enum" ? v.code.replace(/_/g, " ") : "it");
const same = (a: Value, b: Value) =>
  a.kind === "text" && b.kind === "text" ? a.text.normalize("NFKC").trim().toLowerCase() === b.text.normalize("NFKC").trim().toLowerCase() : JSON.stringify(a) === JSON.stringify(b);

type StepKind = "refuse" | "correctWrong" | "correctCurrent" | "retractCurrent" | "transition" | "renameBack";
const stepArb = fc.record({
  kind: fc.constantFrom<StepKind>("refuse", "correctWrong", "correctCurrent", "retractCurrent", "transition", "renameBack"),
  off: fc.oneof(fc.constantFrom(-2 * HOUR, -60_000, 0, 60_000, 2 * HOUR), fc.integer({ min: -72 * HOUR, max: 72 * HOUR })),
  pick: fc.nat(9),
  transition: fc.constantFrom<"illness" | "recovery" | "death">("illness", "recovery", "death"),
});

/** A turn that says `words`, asserted at `at`, and the span over it. */
function turnAt(i: number, at: number, words: string): { e: Evidence; eid: string; proof: ReturnType<typeof spanAt> } {
  const eid = testId(`evstep${i}`);
  const text = `No, it's ${words} now.`;
  return { e: buildEvidence(eid, text, [], ["U"], tsFromMs(at)), eid, proof: spanAt(eid, text, 0, text.length - 1) };
}

function apply(store: Map<string, Memory>, plan: Plan): void {
  if (!plan.ok) return;
  for (const c of plan.commands) if (c.op === "putMemory") store.set(c.id, c.row);
}

describe("Property 5: an error never becomes history (pure)", () => {
  it("after a correction, no later plan makes the wrong value current or history again", () => {
    fc.assert(
      fc.property(fc.constantFrom<ShapeId>("life", "selfName", "rename"), fc.boolean(), fc.array(stepArb, { maxLength: 12 }), (shapeId, withNameRow, steps) => {
        const shape = SHAPES[shapeId];
        const store = new Map<string, Memory>(shape.rows(withNameRow).map((m) => [m.logicalId, m]));
        const assertedAt = new Map<string, number>([
          [PRIOR_EID, msFromTs(PRIOR_AT)],
          [TURN_EID, T],
        ]);
        const onK = () => [...store.values()].filter((m) => m.subjectId === shape.subject && m.predicate === shape.predicate);

        // The correction at t.
        const text0 = `No, it's ${said(shape.right)}, not ${said(shape.wrong)}.`;
        const e0 = buildEvidence(TURN_EID, text0, [], ["U"], TURN_AT);
        const first = applyCorrection(shape.verdict(store), store, planEnv(e0, TURN_EID, spanAt(TURN_EID, text0, 0, text0.length - 1), shape.rows(withNameRow), NOW));
        expect(first.ok, JSON.stringify(first)).toBe(true);
        apply(store, first);
        const wrongIds = onK().filter((m) => m.status === "wrong" && same(m.value, shape.wrong)).map((m) => m.logicalId);
        expect(wrongIds.length, "the corrected value is marked wrong").toBeGreaterThan(0);
        const successors = onK().filter((m) => m.status === "active" && same(m.value, shape.right));
        expect(successors.length, "one successor").toBe(1);
        const successorId = successors[0]!.logicalId;
        let mayChangeSuccessor = false;
        let worldNow = msFromTs(NOW);

        steps.forEach((s, i) => {
          const at = T + s.off;
          worldNow = Math.max(worldNow, at + 5_000);
          const current = onK().find((m) => m.status === "active") ?? null;
          const pool = [shape.wrong, shape.right, ...shape.others];
          const value = pool[s.pick % pool.length]!;
          const args = shape.predicate === "person.life" ? { detail: null } : {};
          let plan: Plan | null = null;
          let targetsSuccessor = false;
          const t = turnAt(i, at, said(value));
          assertedAt.set(t.eid, at);
          const env = (targets: Memory[]) => planEnv(t.e, t.eid, t.proof, targets, tsFromMs(worldNow));
          switch (s.kind) {
            case "refuse":
              for (const id of wrongIds) {
                expect(statusTransition(store.get(id)!.status, "correct")).toBe("refuse");
                expect(statusTransition(store.get(id)!.status, "transition")).toBe("refuse");
              }
              break;
            case "correctWrong": {
              const target = store.get(wrongIds[s.pick % wrongIds.length]!)!;
              plan = applyCorrection({ kind: "correct", targets: [target.logicalId], value, args }, store, env([target]));
              break;
            }
            case "correctCurrent":
              if (current === null || shape.id === "rename") break;
              targetsSuccessor = current.logicalId === successorId;
              plan = applyCorrection({ kind: "correct", targets: [current.logicalId], value, args }, store, env([current]));
              break;
            case "retractCurrent":
              if (current === null || shape.id === "rename") break;
              targetsSuccessor = current.logicalId === successorId;
              plan = applyCorrection({ kind: "retract", targets: [current.logicalId] }, store, env([current]));
              break;
            case "transition":
              if (shape.id !== "life") break;
              // G35: only a turn asserted at or after the successor's own may close it.
              targetsSuccessor = at >= T;
              plan = applyTransition({ kind: "change", transition: s.transition, subject: DAD, counterpart: null, when: at }, store, env(current === null ? [] : [current]));
              break;
            case "renameBack":
              if (shape.id !== "rename" || value.kind !== "text") break;
              targetsSuccessor = true;
              plan = applyCorrection({ kind: "rename", target: SISTER_REL.logicalId, entity: SISTER, from: current !== null && current.value.kind === "text" ? current.value.text : "Mara", to: value.text }, store, env([SISTER_REL]));
              break;
          }
          if (plan !== null) apply(store, plan);
          mayChangeSuccessor ||= targetsSuccessor;

          for (const m of onK()) {
            if (!same(m.value, shape.wrong) || !["active", "scheduled", "history"].includes(m.status)) continue;
            const roots = m.rootSlices.map((r) => r.eid);
            const allLater = roots.length > 0 && roots.every((eid) => (assertedAt.get(eid) ?? -Infinity) > T);
            expect(allLater, `step ${i} (${s.kind}): ${said(shape.wrong)} is ${m.status} again, rooted in ${roots.length} Evidence not all after t`).toBe(true);
          }
          for (const id of wrongIds) expect(store.get(id)!.status, `step ${i} (${s.kind}): the corrected row`).toBe("wrong");
          if (!mayChangeSuccessor) expect(store.get(successorId)!.status, `step ${i} (${s.kind}): the successor`).toBe("active");
        });
      }),
      { numRuns: 300 },
    );
  });
});
