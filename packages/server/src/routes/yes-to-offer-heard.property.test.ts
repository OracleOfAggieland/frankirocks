// Brief 045 part D property 1, "Only an owner's yes to an offer heard to the end writes": for any receipts and any
// turn, the yes applies only if the offer's playback ended uncut or its transcript matched, the yes turn is certainly
// the owner's, and the audience is private. Seed recorded in brief 045's "Outcome, part D".
import type { Session } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { patchRecord } from "../testing/fakes";
import { UID, hero } from "../testing/hero-offer";
import { memoryTick } from "../time/tick";
import { heroOffer } from "./tool-food";

type Ev = "admitted" | "playbackStarted" | "playbackEnded" | "cancelled" | "match" | "miss";
const ev = fc.constantFrom<Ev>("admitted", "playbackStarted", "playbackEnded", "cancelled", "match", "miss");

/** Heard to the end: admitted, started, then ended or matched, with no cancel at or after that point. */
function heard(evs: readonly Ev[]): boolean {
  let admitted = false;
  let started = false;
  let heardAt = -1;
  let cancelled = false;
  evs.forEach((e, i) => {
    if (e === "admitted" && !cancelled) admitted = true;
    if (e === "playbackStarted" && admitted && !cancelled) started = true;
    if ((e === "playbackEnded" || e === "match") && started && !cancelled && heardAt < 0) heardAt = i;
    if (e === "cancelled") cancelled = true;
  });
  return heardAt >= 0 && !evs.slice(heardAt).includes("cancelled");
}

describe("property: only an owner's yes to an offer heard to the end writes (brief 045)", () => {
  it("1,000 runs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(ev, { maxLength: 6 }),
        fc.constantFrom<"O" | "H" | "U" | "timeout">("O", "H", "U", "timeout"),
        fc.constantFrom<"private" | "company" | "unknown">("private", "company", "unknown"),
        fc.boolean(),
        async (evs, judge, audience, byCode) => {
          const h = await hero();
          await memoryTick(h.ctx);
          const { s, proactive } = await h.openLine();
          expect(proactive).not.toBeNull();
          const offer = (await heroOffer(h.ctx, s.stamp.generation))!;
          const receipt = h.played(proactive!, "resp_line_1");
          for (const e of evs) await (e === "match" ? receipt("transcript", proactive!.whisper.text) : e === "miss" ? receipt("transcript", "Something else entirely.") : receipt(e));
          if (audience !== "private") await patchRecord<Session>(h.rig.store, UID, paths.session(UID, s.sessionId), { audience });
          const stamp = await h.say(s, 1, "Yes.", judge);
          const res = await h.answer(stamp, byCode ? { pendingId: null as never, yesId: null as never } : offer);
          const state = res.body.result.state;
          const allowed = heard(evs) && judge === "O" && audience === "private";
          if (state === "applied") expect(allowed).toBe(true);
          else expect(await h.actions()).toBe(0);
          // The plain case, admitted, started and ended with nothing else, applies.
          if (allowed && evs.join() === "admitted,playbackStarted,playbackEnded") expect(state).toBe("applied");
        },
      ),
      { numRuns: 1000, seed: 45_061 },
    );
  }, 600_000);
});
