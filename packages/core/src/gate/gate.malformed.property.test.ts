/**
 * Malformed input is silence (brief 033 property 3, findings 4 and 5; the Gate's header "Never ... throws"; spec §6
 * "It fails quiet"). 1,000 runs.
 *   FOR ALL well-formed candidates and contexts with one field broken (removed, an enum changed in case or value, a
 *   number replaced by NaN, Infinity, a string or undefined, a boolean replaced by a string, an array holding null or
 *   a number, a nested object removed or emptied), the Gate returns `silent` with the reason `invalidInput` and never
 *   throws.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gate } from "./gate";
import { candidateArb, contextArb, topicArb } from "./testing/arb";
import type { GateCandidate, GateContext } from "./types";

type Obj = Record<string, unknown>;
type Break = { on: "c" | "x"; path: string[]; to: unknown[] };

const ENUM = (v: string) => [v.toUpperCase(), v.charAt(0).toUpperCase() + v.slice(1), "bogus", 1, undefined];
const BOOL = ["true", "false", 1, 0, undefined, null];
const NUM = [Number.NaN, Number.POSITIVE_INFINITY, "1", undefined, null, -1];
const ARR = [[null], [1], "terms", undefined, null];
const STR = [1, undefined, {}];

const BREAKS: Break[] = [
  // The candidate.
  { on: "c", path: ["id"], to: STR },
  { on: "c", path: ["kind"], to: ENUM("memory") },
  { on: "c", path: ["subjectId"], to: STR },
  { on: "c", path: ["sourceClass"], to: ["u", "X", undefined] },
  { on: "c", path: ["sens"], to: ["s1", "S3", undefined] },
  { on: "c", path: ["allergy"], to: ["no", "yes", 1, undefined] },
  { on: "c", path: ["eligibility"], to: [undefined, null, {}] },
  { on: "c", path: ["eligibility", "allow"], to: BOOL },
  { on: "c", path: ["toldAt"], to: ["not a time", 1, undefined] },
  { on: "c", path: ["topic", "quiet"], to: ["ALL_OUTPUT", "Unsolicited", "never", undefined] },
  { on: "c", path: ["topic", "terms"], to: ARR },
  { on: "c", path: ["topic", "label"], to: STR },
  { on: "c", path: ["topic", "labelClass"], to: ["u", undefined] },
  { on: "c", path: ["topic", "topicId"], to: STR },
  { on: "c", path: ["queryTerms"], to: ARR },
  { on: "c", path: ["aliases"], to: ARR },
  { on: "c", path: ["purpose"], to: ENUM("suggest") },
  { on: "c", path: ["gravity"], to: [...NUM, 4, 1.5] },
  { on: "c", path: ["food"], to: BOOL },
  { on: "c", path: ["mustSay"], to: ["HardRuleConflict", "always", undefined] },
  { on: "c", path: ["dueAt"], to: ["soon", 1, undefined] },
  { on: "c", path: ["sender"], to: [undefined, {}, "Dana"] },
  { on: "c", path: ["sender", "mailedByOwner"], to: BOOL },
  { on: "c", path: ["attestedPremises"], to: NUM },
  { on: "c", path: ["offerUsed"], to: BOOL },
  { on: "c", path: ["ownRooted"], to: BOOL },
  { on: "c", path: ["checkInUsed"], to: BOOL },
  { on: "c", path: ["act"], to: ENUM("say") },
  // The context.
  { on: "x", path: ["worldNow"], to: ["not a time", 1, undefined] },
  { on: "x", path: ["zone"], to: STR },
  { on: "x", path: ["build"], to: ENUM("floor") },
  { on: "x", path: ["audience"], to: ENUM("private") },
  { on: "x", path: ["modifiers"], to: [undefined, null, {}] },
  { on: "x", path: ["modifiers", "rushed"], to: BOOL },
  { on: "x", path: ["modifiers", "crisis"], to: BOOL },
  { on: "x", path: ["trigger"], to: ENUM("recall") },
  { on: "x", path: ["ownerTurn"], to: [undefined, {}, "Long day"] },
  { on: "x", path: ["ownerTurn", "text"], to: STR },
  { on: "x", path: ["ownerTurn", "certain"], to: BOOL },
  { on: "x", path: ["ownerTurn", "sourceClass"], to: ["u", undefined] },
  { on: "x", path: ["openedTopics"], to: ARR },
  { on: "x", path: ["recentTurns"], to: [[null], [1], [{}], undefined, null] },
  { on: "x", path: ["counts"], to: [undefined, null, {}] },
  { on: "x", path: ["counts", "proactive"], to: NUM },
  { on: "x", path: ["counts", "heavy"], to: NUM },
  { on: "x", path: ["counts", "senderAsks"], to: NUM },
  { on: "x", path: ["counts", "notesThisReply"], to: NUM },
  { on: "x", path: ["rules"], to: ENUM("ready") },
  { on: "x", path: ["authorization"], to: [undefined, {}, "yes"] },
  { on: "x", path: ["authorization", "expiresAt"], to: ["later", 1, undefined] },
  { on: "x", path: ["authorization", "used"], to: BOOL },
  { on: "x", path: ["authorization", "audience"], to: ENUM("private") },
  { on: "x", path: ["authorization", "sourceClass"], to: ["u", undefined] },
];

/** A copy of `root` with the value at `path` set to `v` (`undefined` removes it); null when a parent is missing. */
function broken(root: Obj, path: string[], v: unknown): Obj | null {
  const out = structuredClone(root);
  let o: Obj = out;
  for (const k of path.slice(0, -1)) {
    const next = o[k];
    if (next === null || typeof next !== "object") return null;
    o = next as Obj;
  }
  const last = path[path.length - 1]!;
  if (v === undefined) delete o[last];
  else o[last] = v;
  return out;
}

const fullContext = fc
  .tuple(contextArb, fc.option(fc.record({ text: fc.constant("how is mom"), sourceClass: fc.constant("U" as const), certain: fc.constant(true) }), { nil: null }))
  .map(([x, t]) => ({ ...x, ownerTurn: x.ownerTurn ?? t }));

describe("gate: malformed input is silence", () => {
  it("is silent with invalidInput for any one broken field, and never throws", () => {
    fc.assert(
      fc.property(candidateArb, topicArb, fullContext, fc.nat(), fc.nat(), (c0, t, x, i, j) => {
        // A topic and a sender are present, so their inner fields can be broken.
        const c = { ...c0, topic: c0.topic ?? t, sender: c0.sender ?? { mailedByOwner: true } };
        const b = BREAKS[i % BREAKS.length]!;
        const v = b.to[j % b.to.length];
        const base = (b.on === "c" ? c : x) as unknown as Obj;
        const bad = broken(base, b.path, v);
        fc.pre(bad !== null);
        const cc = (b.on === "c" ? bad : c) as unknown as GateCandidate;
        const xx = (b.on === "x" ? bad : x) as unknown as GateContext;
        let r: ReturnType<typeof gate> | undefined;
        expect(() => (r = gate(cc, xx))).not.toThrow();
        expect(r).toMatchObject({ verdict: "silent", reasons: ["invalidInput"] });
      }),
      { numRuns: 1000 },
    );
  });
});
