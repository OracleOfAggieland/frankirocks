// Brief 030 phase two, part A: delivery's choice on the wire, through the Gate inside `chooseNow`.
import type { CoreEpoch, Moment } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { callRoute, patchRecord, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { momentsOf, ofKind } from "../time/testing";
import { openRoute } from "./open";

const UID = "owner-1";
const ZONE = "America/Chicago";
const NOW = "2026-11-03T12:00:00.000Z";
const openBody = (n: number | string) => ({
  requestId: testId(`open${n}`),
  initiator: "user",
  previousSessionId: null,
  clientZone: ZONE,
  visitId: testId("visit-v1"),
});

async function clone() {
  const rig = testRig();
  await resetAs(rig, UID, "v1", "r1", ZONE);
  return rig;
}

describe("delivery on open", () => {
  it("a seeded clone's open says the wish first, as the Proactive, with a proactive Permit for that moment", async () => {
    const rig = await clone();
    const res = await callRoute(rig, openRoute, openBody(1));
    expect(res.status).toBe(200);
    const [[wishId, wish]] = ofKind(await momentsOf(rig, UID), "wish") as [[string, Moment]];
    expect(res.body.proactive).toMatchObject({ permit: { kind: "proactive", momentIds: [wishId] }, cards: [] });
    expect(res.body.proactive.whisper.text).toBe("Good luck at 2 PM: Tessellate Labs final interview.");
    expect(res.body.proactive.permit.stamp.sessionId).toBe(res.body.sessionId);
    expect(wish.rendered).not.toBeNull();
  });

  it("a replayed open (a lost answer) carries no Proactive: the line is never sent twice from one render", async () => {
    const rig = await clone();
    const first = await callRoute(rig, openRoute, openBody(1));
    expect(first.body.proactive).not.toBeNull();
    const again = await callRoute(rig, openRoute, openBody(1));
    expect(again.status).toBe(200);
    expect(again.body.sessionId).toBe(first.body.sessionId);
    expect(again.body.proactive).toBeNull();
  });

  it("a blocked open says nothing", async () => {
    const rig = await clone();
    await patchRecord<CoreEpoch>(rig.store, UID, paths.core(UID, "epoch"), { barrier: { opId: testId("forget"), phase: "fence", startedAt: NOW, deadline: NOW, queuedOps: [] } });
    const res = await callRoute(rig, openRoute, openBody(2));
    expect(res.body).toMatchObject({ state: "blocked", proactive: null });
  });

  it("an open with nothing due answers proactive: null", async () => {
    const rig = testRig();
    const res = await callRoute(rig, openRoute, { ...openBody(3), visitId: null });
    expect(res.body).toMatchObject({ state: "connecting", proactive: null });
  });
});
