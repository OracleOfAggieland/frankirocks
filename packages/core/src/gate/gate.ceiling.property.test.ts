/**
 * The ceiling holds (brief 024; spec §6 lines 202 to 206, "Ceiling for unprompted saying"). 1,000 runs.
 *   FOR ALL candidates and contexts, the Gate's verdict is never more open than the candidate's cell of the table,
 *   and a say uses only a render that cell allows under its conditions. The oracle below is written from the spec's
 *   table, not read from the Gate's `CEILING` data, so the data is checked too.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tokenize } from "../text";
import { gate } from "./gate";
import { GATE_VERDICTS, type GateRender } from "./reasons";
import { candidateArb, contextArb } from "./testing/arb";
import type { GateCandidate, GateContext } from "./types";

const rank = (v: (typeof GATE_VERDICTS)[number]) => GATE_VERDICTS.length - GATE_VERDICTS.indexOf(v);
const owned = (k: string) => k === "U" || k === "C" || k === "O";

function ownerTokens(x: GateContext): Set<string> | null {
  const t = x.ownerTurn;
  if (t === null || !t.certain || (t.sourceClass !== "U" && t.sourceClass !== "C")) return null;
  return new Set(tokenize(t.text));
}

/** Spec line 216 and line 220, as the oracle reads them. */
function raised(c: GateCandidate, x: GateContext): boolean {
  const words = ownerTokens(x);
  const asked = x.trigger === "recall" && words !== null && c.queryTerms.flatMap((q) => tokenize(q)).some((q) => q.length > 1 && words.has(q));
  const t = c.topic;
  if (asked) return true;
  if (t === null || !owned(t.labelClass)) return false;
  if (x.openedTopics.includes(t.topicId)) return true;
  if (words === null) return false;
  if (t.terms.flatMap((q) => tokenize(q)).some((q) => q.length > 1 && words.has(q))) return true;
  const label = tokenize(t.label).filter((q) => q.length > 1);
  return label.length > 0 && label.every((q) => words.has(q));
}

/** The renders a say may use, by the spec's cell and its conditions. */
function allowedSay(c: GateCandidate, x: GateContext): Set<GateRender> {
  const out = new Set<GateRender>();
  if (x.trigger === "jarTap") return out;
  const s = c.allergy && c.sens === "S2" ? "S1" : c.sens;
  const k = c.sourceClass;
  const plus = x.build === "plus200" && x.audience === "private";
  if (s !== "S2") {
    if (k === "U" || k === "C" || k === "O") out.add("free").add("template");
    if (k === "T" && s === "S0" && c.sender?.mailedByOwner === true) out.add("attributed");
    if (k === "T" && s === "S1" && (c.purpose === "logistics" || c.purpose === "ask")) out.add("attributed");
    if (k === "M" && c.attestedPremises >= 2 && !c.offerUsed) out.add("offer");
  } else {
    if ((k === "U" || k === "C" || k === "O") && plus) out.add("template");
    if (k === "M" && plus && c.ownRooted && c.topic !== null) out.add("template");
  }
  if (raised(c, x)) {
    if (k === "U" || k === "C") out.add("free").add("template");
    if (k === "O") out.add(s === "S2" ? "hedged" : "free").add("template");
    if (k === "T") out.add("attributed");
    if (k === "M") out.add("hedged");
  }
  return out;
}

function maxRank(c: GateCandidate, x: GateContext): number {
  if (allowedSay(c, x).size > 0) return rank("say");
  const s = c.allergy && c.sens === "S2" ? "S1" : c.sens;
  if (x.trigger === "jarTap" || (c.sourceClass === "T" && s !== "S2") || raised(c, x)) return rank("card");
  return rank("hold");
}

describe("gate: the ceiling holds", () => {
  it("is never more open than the candidate's cell", () => {
    fc.assert(
      fc.property(candidateArb, contextArb, (c, x) => {
        const r = gate(c, x);
        expect(rank(r.verdict)).toBeLessThanOrEqual(maxRank(c, x));
        if (r.verdict === "say") expect([...allowedSay(c, x)]).toContain(r.render);
      }),
      { numRuns: 1000 },
    );
  });
});
