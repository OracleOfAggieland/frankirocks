// Brief 042 item 2 (finding 2): an offer answered yes or no, but never recorded as said, is closed with the answer as
// its reason, and is not offered again.
import type { Moment } from "@franki/core";
import { describe, expect, it } from "vitest";
import { heroOffer } from "../routes/tool-food";
import { hero, UID } from "../testing/hero-offer";
import { chooseNow } from "./proactive";
import { memoryTick, scanMoments } from "./tick";

const SIGNALS = { transition: false, crisis: false, turnsSinceCheckInAnswer: null };

async function answered(words: string, pick: "yes" | "no") {
  const h = await hero();
  await memoryTick(h.ctx);
  const s = await h.open();
  const offer = (await heroOffer(h.ctx, s.stamp.generation))!;
  await h.show(s, offer.pendingId);
  const stamp = await h.say(s, 1, words);
  const res = await h.answer(stamp, { pendingId: offer.pendingId, yesId: pick === "yes" ? offer.yesId : offer.noId });
  const insight = async () =>
    ((await scanMoments({ get: (p) => h.rig.store.get(UID, p), query: (q) => h.rig.store.query(UID, q) }, UID)) ?? []).find((d) => d.data.kind === "insight" && d.data.payload.kind === "pattern")!;
  return { h, res, insight };
}

describe("an answered offer is closed (brief 042 item 2)", () => {
  for (const [pick, words, state, reason] of [
    ["yes", "Yes.", "applied", "closed"],
    ["no", "No thanks.", "declined", "declined"],
  ] as const) {
    it(`answered ${pick}: not chosen while its lease holds, and closed as ${reason} by the next tick`, async () => {
      const { h, res, insight } = await answered(words, pick);
      expect(res.body.result.state).toBe(state);
      const before = await insight();
      expect(before.data.status).toBe("leased");
      const { moments } = await chooseNow(h.ctx, { kind: "opening" }, SIGNALS);
      expect(moments.has(before.id as never)).toBe(false);
      h.rig.clock.advance(16 * 60_000);
      await memoryTick(h.ctx);
      const after: Moment = (await insight()).data;
      expect(after.status).toBe("cancelled");
      expect(after.cancelReason).toBe(reason);
      // Three weeks on, it is still not offered.
      h.rig.clock.advance(21 * 24 * 60 * 60_000);
      await memoryTick(h.ctx);
      const later = await chooseNow(h.ctx, { kind: "opening" }, SIGNALS);
      expect(later.moments.has(before.id as never)).toBe(false);
      // Nor is the hero offer, under another moment.
      expect([...later.moments.values()].filter((m) => m.payload.kind === "pattern")).toEqual([]);
    });
  }

  it("an offer never answered is offered again after its lease runs out", async () => {
    const h = await hero();
    await memoryTick(h.ctx);
    await h.open();
    h.rig.clock.advance(16 * 60_000);
    await memoryTick(h.ctx);
    await memoryTick(h.ctx);
    const { choice } = await chooseNow(h.ctx, { kind: "opening" }, SIGNALS);
    expect(choice.spoken).not.toBeNull();
  });
});
