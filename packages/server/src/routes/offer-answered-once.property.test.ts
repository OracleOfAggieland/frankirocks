// Brief 042 property 1, "A shown offer can always be answered once": for any sequence of sessions, showings, other
// turns and answers, a plain yes that is the owner's next turn after the latest showing in its session applies
// exactly once, and any other yes is `clarify`. Seed recorded in brief 042's Outcome.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hero } from "../testing/hero-offer";
import { heroOffer } from "./tool-food";

type Op = "open" | "show" | "other" | "yes";
const op = fc.constantFrom<Op>("open", "show", "other", "yes");

describe("property: a shown offer can always be answered once (brief 042)", () => {
  it("1,000 runs", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 8 }), async (ops) => {
        const h = await hero();
        let s = await h.open();
        const offer = (await heroOffer(h.ctx, s.stamp.generation))!;
        let seq = 0;
        // The oracle: has this session shown the offer with no owner turn since its latest showing?
        let fresh = false;
        let applied = false;
        for (const o of ops) {
          h.rig.clock.advance(1_000);
          if (o === "open") {
            s = await h.open();
            seq = 0;
            fresh = false;
          } else if (o === "show") {
            await h.show(s, offer.pendingId);
            fresh = true;
          } else if (o === "other") {
            await h.say(s, ++seq, "Tell me about Thursday.");
            fresh = false;
          } else {
            const stamp = await h.say(s, ++seq, "Yes.");
            const state = (await h.answer(stamp, offer)).body.result.state;
            if (!applied && fresh) {
              expect(state).toBe("applied");
              applied = true;
            } else if (!applied) expect(state).toBe("clarify");
            else expect(state).not.toBe("declined");
            fresh = false;
          }
          expect(await h.actions()).toBe(applied ? 1 : 0);
        }
      }),
      { numRuns: 1000, seed: 42_042 },
    );
  }, 600_000);
});
