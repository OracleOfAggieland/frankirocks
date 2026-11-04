/**
 * Head properties (R26.12, R26.13; R28.3). 200 runs each.
 *   determinism: the same Memories in any order, the same core state and ClockPair give byte-identical text.
 *   lineage: every know line traces to a selectedRef whose Memory passes eligible and Spoken_Grade and is S0/S1,
 *            and no failing Memory's value text appears anywhere in Head.text.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { eligible } from "./eligible";
import { type HeadMemory, compileHead } from "./head";
import type { Memory } from "./schema/records";
import { spokenGrade } from "./spoken";
import { memRef, sampleCoreDocs, sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "./testing";

const EID = testId("ev");
const DAY = Date.UTC(2026, 10, 3, 12);

const PRED_SHAPES = [
  { predicate: "fact", kind: "fact", value: (t: string) => ({ kind: "text", text: t }), args: { topic: "other", label: null } },
  { predicate: "goal", kind: "goal", value: (t: string) => ({ kind: "text", text: t }), args: { domain: "work" } },
  { predicate: "person.life", kind: "fact", value: () => ({ kind: "enum", code: "alive" }), args: { detail: null } },
  { predicate: "preference.food", kind: "preference", value: () => ({ kind: "enum", code: "like" }), args: { dimension: "dish", targetRef: null } },
  { predicate: "handling", kind: "fact", value: () => ({ kind: "enum", code: "brief" }), args: { personRef: "self", context: "work", dimension: "detail" } },
] as const;

const memoryArb = (n: number): fc.Arbitrary<HeadMemory> =>
  fc
    .record({
      shape: fc.constantFrom(...PRED_SHAPES),
      sens: fc.constantFrom("S0", "S1", "S2"),
      sourceClass: fc.constantFrom("U", "C", "O", "T", "M"),
      status: fc.constantFrom("active", "active", "history", "alleged", "blocked"),
      flow: fc.constantFrom("open", "open", "never_outbound"),
      dirty: fc.constantFrom(false, false, false, true),
      key: fc.integer({ min: 0, max: 6 }),
      words: fc.array(fc.constantFrom("Pip", "dog", "beagle", "coffee", "Paris", "runs", "late"), { minLength: 1, maxLength: 6 }),
    })
    .map((r) => {
      // The `#n#` tag makes each value unique, so "not in the text" cannot match another Memory's value.
      const text = `${r.words.join(" ")} #${n}#`;
      const memory = sampleMemory({
        predicate: r.shape.predicate,
        kind: r.shape.kind,
        value: r.shape.value(text) as Memory["value"],
        args: { ...r.shape.args },
        sens: r.sens,
        sourceClass: r.sourceClass,
        status: r.status,
        flow: r.flow,
        dirty: r.dirty,
        key: testId(`key${r.key}`),
      });
      return { id: testId(`mem${n}`), memory };
    });

const setArb = fc.integer({ min: 0, max: 40 }).chain((size) => fc.tuple(...Array.from({ length: size }, (_, n) => memoryArb(n))));

function inputFor(memories: readonly HeadMemory[]) {
  return {
    memories,
    ec: sampleEC(),
    snapshot: sampleSnapshot({ memories: memories.map((m) => [m.id, m.memory] as [string, Memory]), evidence: [[EID, sampleEvidence()]] }),
    rules: sampleCoreDocs().rules,
    clock: { worldClock: { now: DAY, zone: "America/Chicago" }, opsClock: { now: DAY } },
  };
}

describe("compileHead properties", () => {
  it("determinism: any input order gives byte-identical Head text", () => {
    fc.assert(
      fc.property(setArb, fc.integer(), (memories, seed) => {
        const shuffled = [...memories].sort((a, b) => ((a.id.charCodeAt(4) * 31 + seed) % 7) - ((b.id.charCodeAt(4) * 31 + seed) % 7));
        const a = compileHead(inputFor(memories));
        const b = compileHead(inputFor([...shuffled].reverse()));
        expect(a.ok && b.ok).toBe(true);
        if (a.ok && b.ok) {
          expect(b.head.text).toBe(a.head.text);
          expect(b.head).toEqual(a.head);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("every know line traces to an eligible S0/S1 ref, and no failing Memory reaches the text", () => {
    fc.assert(
      fc.property(setArb, (memories) => {
        const input = inputFor(memories);
        const r = compileHead(input);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const byId = new Map(memories.map((m) => [m.id, m]));
        const selected = new Set(r.head.selectedRefs.map((ref) => ref.id));
        for (const line of r.lines) {
          if (line.ref === null) continue;
          expect(selected.has(line.ref.id)).toBe(true);
          const m = byId.get(line.ref.id)!;
          const x = { ref: memRef(m.id), row: m.memory };
          expect(eligible(x, { ...input.ec, stage: "project" }, input.snapshot).allow).toBe(true);
          expect(spokenGrade(x, input.ec, input.snapshot).allow).toBe(true);
          expect(["S0", "S1"]).toContain(m.memory.sens);
        }
        expect(r.lines.filter((l) => l.section === "know" && l.ref === null).length).toBeLessThanOrEqual(1);
        for (const m of memories) {
          const x = { ref: memRef(m.id), row: m.memory };
          if (spokenGrade(x, input.ec, input.snapshot).allow) continue;
          if (m.memory.value.kind === "text") expect(r.head.text).not.toContain(m.memory.value.text);
          expect(selected.has(m.id)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });
});
