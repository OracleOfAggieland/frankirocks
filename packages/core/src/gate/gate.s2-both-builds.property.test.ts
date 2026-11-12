/**
 * S2 stays off the wire, in both builds (brief 033 property 7, finding 15; spec §6 line 218 "The floor build has no
 * on-screen ask, so S2 stays off the wire there", §3 the `proactive` row; brief 024 ruling 2). 1,000 runs.
 *   FOR ALL S2 candidates that are not allergies and every context, floor or +200 (half of them an owner's asked
 *   recall on an opened topic): a `say` carries one of the code carve-outs (check-in, door, O logistics, exact
 *   authorization), never the opened-topic recall, and the whisper built for it from a note of S2 phrases holds
 *   none of them.
 * The S2 phrases here each fail every typed slot (they hold digits, punctuation or more than four words). A
 * letters-only phrase can still pass a name slot; see the brief's Outcome.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testId } from "../testing/samples";
import { buildWhisper } from "../whisper/build";
import { templateFor } from "../whisper/templates";
import { gate } from "./gate";
import { candidateArb, contextArb } from "./testing/arb";

const S2_PHRASES = ["10 at the fertility clinic", "biopsy: positive", "Mom's chemo, stage 2", "therapy at 4, couples", "the HIV test came back", "owes $40,000 on the card"];

describe("gate: S2 stays off the wire in both builds", () => {
  it("says S2 only through a code carve-out, with no S2 phrase in its whisper", () => {
    fc.assert(
      fc.property(candidateArb, contextArb, fc.constantFrom("floor", "plus200" as const), fc.subarray(S2_PHRASES, { minLength: 1, maxLength: 4 }), fc.boolean(), (c0, x0, build, tokens, ask) => {
        const c = { ...c0, sens: "S2" as const, allergy: false };
        // Half the cases are the owner asking about an opened topic, so the opened-topic recall is reached often.
        const words = [...c.queryTerms, ...(c.topic?.terms ?? []), c.topic?.label ?? ""].join(" ");
        const x = ask
          ? { ...x0, build, trigger: "recall" as const, ownerTurn: { text: words, sourceClass: "U" as const, certain: true }, openedTopics: c.topic === null ? [] : [c.topic.topicId] }
          : { ...x0, build };
        const r = gate(c, x);
        if (r.verdict !== "say") return;
        expect(["checkIn", "door", "oLogistics", "authorization"]).toContain(r.carveOut);
        const t = templateFor(r);
        expect(t).not.toBeNull();
        const note = { noteId: testId("n1"), momentId: null, sens: "S2" as const, rootKeys: [], dependsOn: [], tokens, candidateId: c.id };
        const w = buildWhisper(note, r, t!, { opsNow: 1_700_000_000_000, trigger: x.trigger });
        if (w === null) return;
        for (const p of S2_PHRASES) expect(w.text.includes(p)).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});
