// Brief 045 finding 6, with brief 042 item 1: an offer is shown when its playback ended uncut or its transcript
// matched; a cancel revokes the showing; a yes writes only when the turn is certainly the owner's and the Session is
// private.
import type { Session } from "@franki/core";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { patchRecord } from "../testing/fakes";
import { UID, hero } from "../testing/hero-offer";
import { memoryTick } from "../time/tick";
import { heroOffer } from "./tool-food";

async function offered() {
  const h = await hero();
  await memoryTick(h.ctx);
  const { s, proactive } = await h.openLine();
  expect(proactive).not.toBeNull();
  const offer = (await heroOffer(h.ctx, s.stamp.generation))!;
  const receipt = h.played(proactive!, "resp_line_1");
  await receipt("admitted");
  await receipt("playbackStarted");
  return { h, s, offer, receipt, line: proactive!.whisper.text };
}

describe("an offer heard to the end, and the owner's own private yes (brief 045 finding 6)", () => {
  it("played to the end, uncut: the owner's yes applies", async () => {
    const t = await offered();
    await t.receipt("playbackEnded");
    const stamp = await t.h.say(t.s, 1, "Yes.");
    expect((await t.h.answer(stamp, t.offer)).body.result.state).toBe("applied");
  });

  it("its transcript matched: the owner's yes applies", async () => {
    const t = await offered();
    await t.receipt("transcript", t.line);
    const stamp = await t.h.say(t.s, 1, "Yes.");
    expect((await t.h.answer(stamp, t.offer)).body.result.state).toBe("applied");
  });

  it("a barge-in after one word: the cancel leaves nothing shown, and \"Okay?\" or \"Yes.\" writes nothing", async () => {
    const t = await offered();
    await t.receipt("cancelled");
    const stamp = await t.h.say(t.s, 1, "Yes.");
    expect((await t.h.answer(stamp, t.offer)).body.result.state).toBe("clarify");
    expect(await t.h.actions()).toBe(0);
  });

  it("started but never ended or matched: not shown", async () => {
    const t = await offered();
    const stamp = await t.h.say(t.s, 1, "Yes.");
    expect((await t.h.answer(stamp, t.offer)).body.result.state).toBe("clarify");
  });

  it("matched, then cancelled: the cancel revokes the showing", async () => {
    const t = await offered();
    await t.receipt("transcript", t.line);
    await t.receipt("cancelled");
    const stamp = await t.h.say(t.s, 1, "Yes.");
    expect((await t.h.answer(stamp, t.offer)).body.result.state).toBe("clarify");
  });

  for (const judge of ["timeout", "H", "U"] as const) {
    it(`heard to the end, but the judge said ${judge}: clarify, nothing written`, async () => {
      const t = await offered();
      await t.receipt("playbackEnded");
      const stamp = await t.h.say(t.s, 1, "Yes.", judge);
      expect((await t.h.answer(stamp, t.offer)).body.result.state).toBe("clarify");
      expect(await t.h.actions()).toBe(0);
    });
  }

  for (const audience of ["company", "unknown"] as const) {
    it(`heard to the end, the owner's yes, but the audience is ${audience}: clarify`, async () => {
      const t = await offered();
      await t.receipt("playbackEnded");
      await patchRecord<Session>(t.h.rig.store, UID, paths.session(UID, t.s.sessionId), { audience });
      const stamp = await t.h.say(t.s, 1, "Yes.");
      expect((await t.h.answer(stamp, t.offer)).body.result.state).toBe("clarify");
      expect(await t.h.actions()).toBe(0);
    });
  }

  it("the path with null IDs is held to the same checks", async () => {
    const t = await offered();
    await t.receipt("playbackEnded");
    const stamp = await t.h.say(t.s, 1, "Yes.", "timeout");
    const res = await t.h.rig.deps.store.get(UID, paths.session(UID, t.s.sessionId));
    expect(res).not.toBeNull();
    const nulls = await t.h.answer(stamp, { pendingId: null as never, yesId: null as never });
    expect(nulls.body.result.state).toBe("clarify");
    expect(await t.h.actions()).toBe(0);
  });
});
