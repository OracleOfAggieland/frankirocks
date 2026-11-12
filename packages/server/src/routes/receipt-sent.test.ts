// Brief 045 findings 12 and 7. A receipt counts only for what the server sent to this Session (the moment and its
// pending ID, recorded with the render); a call's `answer` result carries no pending ID. A screen's receipt admits no
// line that asks for an answer, and a screen's `pendingRendered` is never a showing, so an offer that went out on a
// typed open is not used up and stays for a call.
import type { Moment, Proactive } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { callRoute } from "../testing/fakes";
import { UID, hero } from "../testing/hero-offer";
import { memoryTick } from "../time/tick";
import { momentsOf } from "../time/testing";
import { receiptRoute } from "./receipt";
import { heroOffer } from "./tool-food";

type H = Awaited<ReturnType<typeof hero>>;

/** The hero offer chosen at an open. */
async function offered() {
  const h = await hero();
  await memoryTick(h.ctx);
  const { s, proactive } = await h.openLine();
  expect(proactive).not.toBeNull();
  const offer = (await heroOffer(h.ctx, s.stamp.generation))!;
  return { h, s, p: proactive!, offer };
}

const momentOf = async (h: H, p: Proactive): Promise<Moment> => (await momentsOf(h.rig, UID)).get(p.permit.momentIds[0]!)!;
let r = 0;
async function receipt(h: H, stamp: unknown, p: Proactive, responseId: string, kind: string, extra: Record<string, unknown> = {}) {
  h.rig.clock.advance(10);
  const res = await callRoute(h.rig, receiptRoute, { requestId: testId(`rs${++r}`), stamp, responseId, kind, momentIds: p.permit.momentIds, noteIds: p.permit.noteIds, pendingId: null, permitKind: kind === "admitted" ? "proactive" : null, text: null, ...extra });
  expect(res.status).toBe(200);
}

describe("brief 045 finding 12: a receipt counts only for what was sent to this Session", () => {
  it("the moment sent to Session A, then rendered again for Session B: A's receipts admit nothing and show nothing", async () => {
    const t = await offered();
    const b = await t.h.openLine();
    expect(b.proactive?.permit.momentIds).toEqual(t.p.permit.momentIds);
    expect((await momentOf(t.h, t.p)).rendered).toMatchObject({ sessionId: b.s.sessionId });
    for (const kind of ["admitted", "playbackStarted", "playbackEnded"]) await receipt(t.h, t.p.permit.stamp, t.p, "resp_a", kind);
    const m = await momentOf(t.h, t.p);
    expect([m.status, m.admittedAt, m.playbackAt]).toEqual(["leased", null, null]);
  });

  it("a pendingRendered receipt naming the offer's pending ID, with no moment sent: not shown", async () => {
    const t = await offered();
    await receipt(t.h, t.p.permit.stamp, { ...t.p, permit: { ...t.p.permit, momentIds: [], noteIds: [] } }, "resp_x", "pendingRendered", { pendingId: t.offer.pendingId });
    const yes = await t.h.say(t.s, 1, "Yes.");
    expect((await t.h.answer(yes, t.offer)).body.result.state).toBe("clarify");
  });

  it("played to the end on the Session it was sent to: the yes applies, and the answer carries no pending ID", async () => {
    const t = await offered();
    for (const kind of ["admitted", "playbackStarted", "playbackEnded"]) await receipt(t.h, t.p.permit.stamp, t.p, "resp_line", kind);
    const yes = await t.h.say(t.s, 1, "Yes.");
    const res = (await t.h.answer(yes, t.offer)).body;
    expect(res.result.state).toBe("applied");
    expect(res.result.pendingId).toBeNull();
    expect(JSON.stringify(res)).not.toContain(t.offer.pendingId);
  });

  it("the render records the Session and the pending ID it was sent with", async () => {
    const t = await offered();
    expect((await momentOf(t.h, t.p)).rendered).toMatchObject({ sessionId: t.s.sessionId, pendingId: t.offer.pendingId });
  });
});

describe("brief 045 finding 7: a typed open shows and admits only lines that need no answer", () => {
  it("the hero offer goes out marked as asking for an answer", async () => {
    const t = await offered();
    expect(t.p).toMatchObject({ asks: true });
  });

  it("on the screen, its admitted receipt admits nothing and its pendingRendered shows nothing; the moment stays for a call", async () => {
    const t = await offered();
    const responseId = `shown_${t.p.turnId}`;
    await receipt(t.h, t.p.permit.stamp, t.p, responseId, "admitted");
    await receipt(t.h, t.p.permit.stamp, t.p, responseId, "pendingRendered");
    const m = await momentOf(t.h, t.p);
    expect(m.status).toBe("leased");
    expect(m.admittedAt).toBeNull();
    const yes = await t.h.say(t.s, 1, "Yes.");
    expect((await t.h.answer(yes, t.offer)).body.result.state).toBe("clarify");
  });
});
