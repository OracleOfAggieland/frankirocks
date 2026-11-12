// Feature: voice-writes (brief 012 wave D, task D1), Property 14: the dead are not brought up (design section 7,
// G15, CQ 110). For any Memories and an entity whose current eligible `person.life` is `deceased`, no line with that
// entity in `entityIds` is in `people`, `apply`, `openers` or `next72`. The death row itself is S2 (its words are), so
// it never renders; the join reads it as truth. Life rows come in every status, code and Sensitivity; other lines name
// the entity, another person or both, across the people, apply and know predicates.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type HeadMemory, compileHead } from "./head";
import type { Memory } from "./schema/records";
import { sampleCoreDocs, sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "./testing";

const EID = testId("ev");
const DAY = Date.UTC(2026, 10, 3, 12);
const DAD = testId("entity-dad");
const SIS = testId("entity-sis");
const PROACTIVE = new Set(["people", "apply", "openers", "next72"]);
const say = (text: string) => ({ text, entityRefs: [], timeFields: [] });

const lifeArb = fc.record({
  code: fc.constantFrom("deceased", "deceased", "alive", "ill"),
  status: fc.constantFrom<Memory["status"]>("active", "active", "history", "wrong"),
  sens: fc.constantFrom<Memory["sens"]>("S0", "S1", "S2"),
});
const lineArb = fc.record({
  pred: fc.constantFrom("person.relation", "handling", "fact"),
  who: fc.constantFrom<"dad" | "sis" | "both">("dad", "sis", "both"),
  sens: fc.constantFrom<Memory["sens"]>("S0", "S1"),
});

function build(life: { code: string; status: Memory["status"]; sens: Memory["sens"] } | null, lines: { pred: string; who: "dad" | "sis" | "both"; sens: Memory["sens"] }[]): HeadMemory[] {
  const out: HeadMemory[] = [];
  if (life !== null) {
    out.push({
      id: testId("m-life"),
      memory: sampleMemory({ key: testId("k-life"), subjectId: DAD, predicate: "person.life", value: { kind: "enum", code: life.code }, args: { detail: null }, status: life.status, sens: life.sens, entityIds: [DAD], sayAs: say(`The owner's dad is ${life.code}.`) }),
    });
  }
  lines.forEach((l, i) => {
    const ents = l.who === "dad" ? [DAD] : l.who === "sis" ? [SIS] : [DAD, SIS];
    const args = l.pred === "person.relation" ? { otherRef: ents[0]!, label: null, employerRef: null } : l.pred === "handling" ? { personRef: ents[0]!, context: "social", dimension: "tone" } : { topic: "other", label: null };
    const value = l.pred === "person.relation" ? { kind: "enum" as const, code: "parent" } : l.pred === "handling" ? { kind: "enum" as const, code: "casual" } : { kind: "text" as const, text: `thing ${i}` };
    out.push({
      id: testId(`m-${i}`),
      memory: sampleMemory({ key: testId(`k-${i}`), subjectId: l.pred === "fact" ? ents[0]! : "self", predicate: l.pred as Memory["predicate"], value, args, sens: l.sens, entityIds: ents, sayAs: say(`Line ${i} about ${l.who}.`) }),
    });
  });
  return out;
}

describe("Property 14: the dead are not brought up", () => {
  it("no proactive line names an entity whose current life row is deceased", () => {
    let reached = 0;
    fc.assert(
      fc.property(fc.option(lifeArb, { nil: null }), fc.array(lineArb, { minLength: 1, maxLength: 8 }), (life, lines) => {
        const mems = build(life, lines);
        const byId = new Map(mems.map((m) => [m.id, m.memory]));
        const snapshot = sampleSnapshot({ memories: mems.map((m) => [m.id, m.memory]), evidence: [[EID, sampleEvidence()]] });
        const head = compileHead({ memories: mems, ec: sampleEC(), snapshot, rules: sampleCoreDocs().rules, clock: { worldClock: { now: DAY, zone: "UTC" }, opsClock: { now: DAY } } });
        expect(head.ok).toBe(true);
        if (!head.ok) return;
        const deceased = life !== null && life.code === "deceased" && life.status === "active";
        if (!deceased) {
          // Alive or unknown: the same lines do reach the proactive sections, so the check below is not vacuous.
          reached += head.lines.filter((l) => l.ref !== null && PROACTIVE.has(l.section) && (byId.get(l.ref.id)!.entityIds ?? []).includes(DAD)).length;
          return;
        }
        for (const l of head.lines) {
          if (l.ref === null || !PROACTIVE.has(l.section)) continue;
          const m = byId.get(l.ref.id)!;
          expect((m.entityIds ?? []).includes(DAD), `${JSON.stringify({ life, lines })}: "${l.text}" is in ${l.section}`).toBe(false);
        }
      }),
      { numRuns: 1000 },
    );
    expect(reached).toBeGreaterThan(100);
  });
});
