// Brief 042 item 1 (finding 3): an offer shown again in a later session can be answered there.
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { UID, hero } from "../testing/hero-offer";
import { renderedEntryId } from "../time/reminder";
import { heroOffer } from "./tool-food";

describe("an offer shown again can be answered (brief 042 item 1)", () => {
  it("shown in session one, shown again in session two: a plain yes there applies", async () => {
    const h = await hero();
    const s1 = await h.open();
    const offer = (await heroOffer(h.ctx, s1.stamp.generation))!;
    expect(offer).not.toBeNull();
    await h.show(s1, offer.pendingId);
    await h.say(s1, 1, "Not right now, thanks.");
    h.rig.clock.advance(60_000);
    const s2 = await h.open();
    await h.show(s2, offer.pendingId);
    const stamp = await h.say(s2, 1, "Yes.");
    const res = await h.answer(stamp, offer);
    expect(res.body.result.state).toBe("applied");
  });

  it("the first showing's row is kept as it was", async () => {
    const h = await hero();
    const s1 = await h.open();
    const offer = (await heroOffer(h.ctx, s1.stamp.generation))!;
    await h.show(s1, offer.pendingId);
    const first = await h.rig.store.get(UID, paths.ledger(UID, renderedEntryId(h.rig.deps.hasher, offer.pendingId)));
    h.rig.clock.advance(60_000);
    const s2 = await h.open();
    await h.show(s2, offer.pendingId);
    expect(await h.rig.store.get(UID, paths.ledger(UID, renderedEntryId(h.rig.deps.hasher, offer.pendingId)))).toEqual(first);
  });

  it("shown only in session one: a yes in session two is clarify", async () => {
    const h = await hero();
    const s1 = await h.open();
    const offer = (await heroOffer(h.ctx, s1.stamp.generation))!;
    await h.show(s1, offer.pendingId);
    h.rig.clock.advance(60_000);
    const s2 = await h.open();
    const stamp = await h.say(s2, 1, "Yes.");
    expect((await h.answer(stamp, offer)).body.result.state).toBe("clarify");
  });

  it("shown twice in one session: a yes after the first showing, before the second, does not bind the second", async () => {
    const h = await hero();
    const s1 = await h.open();
    const offer = (await heroOffer(h.ctx, s1.stamp.generation))!;
    await h.show(s1, offer.pendingId);
    await h.say(s1, 1, "Hmm, let me think.");
    await h.show(s1, offer.pendingId);
    await h.say(s1, 2, "Tell me about Thursday.");
    const stamp = await h.say(s1, 3, "Yes.");
    expect((await h.answer(stamp, offer)).body.result.state).toBe("clarify");
  });
});
