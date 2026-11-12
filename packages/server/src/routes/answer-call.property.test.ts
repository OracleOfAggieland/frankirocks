// Feature: what the voice machine sends (brief 040), Property 4: a yes in a call is the owner's.
// For any committed turns, any record of the offer as shown (or none) and any arguments the model wrote, `answer` as a
// call sends it (callToolArgs: both IDs null) applies only when brief 037's binding holds (the offer was shown, and
// this is the owner's next turn after it) and the owner's own words are a plain yes; it declines only when the binding
// holds and the words are a plain no; anything else is `clarify`. The model's arguments never change the outcome,
// even when they name the offer's real pending ID and yes ID. A list is written exactly when the answer applies.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { callToolArgs, isPlainNo, isPlainYes } from "@franki/core";
import { answerCallSetup } from "../testing/answer-call-fixture";

const YESES = ["Yes", "Yes, let's do it", "OK please", "Sure.", "sounds good"];
const NOES = ["No", "Nope!", "No thanks", "Not now", "nah"];
const OTHERS = ["Maybe later", "What's on tomorrow", "Yes, but not tonight", "No, but ask me tomorrow", "Sure, tell me more first", "I said yes to Dana", "hmm"];
const words = fc.oneof(fc.constantFrom(...YESES), fc.constantFrom(...NOES), fc.constantFrom(...OTHERS), fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() !== ""));

/** What the model may write as `answer`'s arguments; `REAL` is replaced by the offer's own IDs after setup. */
const modelArgs = fc.oneof(
  fc.constant("{}"),
  fc.constant("REAL_YES"),
  fc.constant("REAL_NO"),
  fc.json({ maxDepth: 2 }),
  fc.record({ pendingId: fc.option(fc.string({ maxLength: 43 })), choiceId: fc.option(fc.string({ maxLength: 43 })) }).map((o) => JSON.stringify(o)),
);

describe("Property 4: a yes in a call is the owner's", () => {
  it("applies only on the binding and a plain yes, declines only on the binding and a plain no; the model's arguments never matter", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(words, { minLength: 1, maxLength: 3 }), fc.option(fc.nat(2)), modelArgs, async (turns, presentRaw, raw) => {
        const present = presentRaw === null ? null : presentRaw % turns.length;
        const t = await answerCallSetup({ turns, present });
        expect(t.offer).not.toBeNull();
        const written =
          raw === "REAL_YES" ? JSON.stringify({ pendingId: t.offer!.pendingId, choiceId: t.offer!.yesId })
          : raw === "REAL_NO" ? JSON.stringify({ pendingId: t.offer!.pendingId, choiceId: t.offer!.noId })
          : raw;
        const sent = callToolArgs("answer", written);
        if (sent === null) return; // arguments that don't parse send nothing
        expect(sent.args).toEqual({ pendingId: null, choiceId: null });
        const res = await t.tool({ name: "answer", args: sent.args as Record<string, unknown> });
        expect(res.status).toBe(200);
        const last = turns[turns.length - 1]!;
        const bound = present === turns.length - 1;
        const want = bound && isPlainYes(last) ? "applied" : bound && isPlainNo(last) ? "declined" : "clarify";
        expect(res.body.result?.state ?? res.body.status, JSON.stringify({ turns, present, last })).toBe(want);
        expect((await t.actions()).length).toBe(want === "applied" ? 1 : 0);
      }),
      { numRuns: 1000 },
    );
  }, 600_000);
});
