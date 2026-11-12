/**
 * An opened topic never lifts unprompted mail (brief 033 property 1, finding 1; spec §6 ceiling, T column; contracts
 * §2 "T unprompted=mailed sender/type only, else card", "Q<=1/sender/day"). 1,000 runs.
 *   FOR ALL class T candidates and contexts on the `unprompted` trigger, the verdict with the candidate's topic opened
 *   earlier in the Session is never more open than with no topic opened, and a `senderCap` card stays a card.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gate } from "./gate";
import { GATE_VERDICTS } from "./reasons";
import { candidateArb, contextArb, topicArb } from "./testing/arb";

const rank = (v: (typeof GATE_VERDICTS)[number]) => GATE_VERDICTS.length - GATE_VERDICTS.indexOf(v);

describe("gate: an opened topic never lifts unprompted mail", () => {
  it("opening the topic leaves an unprompted T verdict no more open", () => {
    fc.assert(
      fc.property(candidateArb, topicArb, contextArb, fc.integer({ min: 0, max: 9 }), (c0, t, x0, senderAsks) => {
        const c = { ...c0, sourceClass: "T" as const, topic: { ...t, quiet: null } };
        const closed = { ...x0, trigger: "unprompted" as const, openedTopics: [], counts: { ...x0.counts, senderAsks } };
        const open = { ...closed, openedTopics: [t.topicId] };
        const a = gate(c, closed);
        const b = gate(c, open);
        expect(rank(b.verdict)).toBeLessThanOrEqual(rank(a.verdict));
        if (a.reasons.includes("senderCap")) expect(b.verdict).not.toBe("say");
        if (b.verdict === "say") expect(b.reasons).not.toContain("topicOpen");
      }),
      { numRuns: 1000 },
    );
  });
});
