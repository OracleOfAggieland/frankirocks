// Brief 043, new property 2: only the owner's words choose who it happened to. For any life-change item whose span
// names someone other than a stored entity E (by a possessive before or after E's name, or by another name), and any
// subject the model gives (E's ID, a mention over any words of the turn, or self), validation never chooses E, and no
// Command the planner writes changes a row of E.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EID } from "../schema/primitives";
import type { Memory } from "../schema/records";
import { DAD, DAD_LIFE, SISTER, SISTER_REL, SELF_NAME, TURN_AT, TURN_EID, buildEvidence, planEnv, spanAt, targetsMap, validateContext } from "./testing/arb-writes";
import { applyTransition } from "./transition";
import type { FastItem, Subject } from "./types";
import { validateItems } from "./validate";

const STORED: readonly { id: EID; words: readonly string[] }[] = [
  { id: DAD, words: ["dad", "Dad"] },
  { id: SISTER, words: ["sister", "Maya"] },
];
const OWNERS = ["My friend's", "Sam's", "His", "Her", "Their", "My boss's", "Your", "A neighbour's"] as const;
const OTHER_NAMES = ["Tom", "Priya", "my neighbour Tom", "Grandpa Joe"] as const;
const AFTER = ["dog", "cat", "husband", "boss"] as const;
const VERBS = [
  ["death", "passed away last night"],
  ["death", "died yesterday"],
  ["illness", "was diagnosed with cancer"],
  ["recovery", "got better last week"],
] as const;

type Shape = { kind: "before"; owner: string } | { kind: "after"; pet: string } | { kind: "otherName"; name: string };
const shapeArb: fc.Arbitrary<Shape> = fc.oneof(
  fc.constantFrom(...OWNERS).map((owner): Shape => ({ kind: "before", owner })),
  fc.constantFrom(...AFTER).map((pet): Shape => ({ kind: "after", pet })),
  fc.constantFrom(...OTHER_NAMES).map((name): Shape => ({ kind: "otherName", name })),
);

function sentence(shape: Shape, word: string, verb: string): string {
  switch (shape.kind) {
    case "before":
      return `${shape.owner} ${word} ${verb}.`;
    case "after":
      return `My ${word}'s ${shape.pet} ${verb}.`;
    case "otherName":
      return `${shape.name[0]!.toUpperCase()}${shape.name.slice(1)} ${verb}.`;
  }
}

/** Every run of one to three words of the text, as mention spans. */
function wordRuns(text: string): { start: number; end: number }[] {
  const ws = [...text.matchAll(/[\p{L}]+(?:['’][\p{L}]+)*/gu)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  const out: { start: number; end: number }[] = [];
  for (let i = 0; i < ws.length; i++) for (let n = 1; n <= 3 && i + n <= ws.length; n++) out.push({ start: ws[i]!.start, end: ws[i + n - 1]!.end });
  return out;
}

const subjectPickArb = fc.record({ form: fc.constantFrom("entity", "mention", "mention", "self"), at: fc.nat() });

describe("Property 2 (brief 043): only the owner's words choose who it happened to", () => {
  it("E is never the subject or counterpart of a change, and no row of E changes", () => {
    fc.assert(
      fc.property(fc.constantFrom(...STORED), fc.nat(), shapeArb, fc.constantFrom(...VERBS), subjectPickArb, fc.option(subjectPickArb, { nil: null }), (E, wi, shape, [kind, verb], sp, cp) => {
        const word = E.words[wi % E.words.length]!;
        const text = sentence(shape, word, verb);
        const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
        const runs = wordRuns(text);
        const pick = (p: { form: string; at: number }): Subject => {
          if (p.form === "entity") return { entityId: E.id, mention: null, isSelf: false };
          if (p.form === "self") return { entityId: null, mention: null, isSelf: true };
          const r = runs[p.at % runs.length]!;
          return { entityId: null, mention: spanAt(TURN_EID, text, r.start, r.end), isSelf: false };
        };
        const item: FastItem = { kind: "transition", transition: kind, subject: pick(sp), counterpart: cp === null ? null : pick(cp), whenSpoken: null, polarity: "affirmed", act: "direct", span: spanAt(TURN_EID, text, 0, text.length - 1) };
        const rows: Memory[] = [SELF_NAME, SISTER_REL, DAD_LIFE];
        const [v] = validateItems({ items: [item], need: "none" }, validateContext(e, { targets: targetsMap(rows) }));
        const what = `${text} with ${JSON.stringify(item.subject)} / ${JSON.stringify(item.counterpart)}`;
        if (v?.kind !== "transition" || v.v.kind !== "change") return;
        expect(v.v.subject, `${what}: E chosen as the subject`).not.toBe(E.id);
        expect(v.v.counterpart, `${what}: E chosen as the counterpart`).not.toBe(E.id);
        const plan = applyTransition(v.v, new Map(rows.map((m) => [m.logicalId, m])), planEnv(e, TURN_EID, item.span, rows));
        for (const c of plan.ok ? plan.commands : []) {
          if (c.op !== "putMemory") continue;
          expect([c.row.subjectId, c.row.args.careSubjectRef, c.row.args.otherRef], `${what}: a row of E changed`).not.toContain(E.id);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
