import { type Proactive, type Session, ERRAND_SILENCE_MS, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { receiptRoute } from "../routes/receipt";
import { stateRoute } from "../routes/state";
import { cFields } from "../records";
import { paths } from "../store/paths";
import { callRoute, patchRecord, testRig } from "../testing/fakes";
import { openTestSession } from "../testing/session-fixtures";
import type { WebSearchEntry } from "./tasks";

const uid = "owner-1";
const task = testId("search");
const item = { text: "The gallery opens at 10.", sources: [{ title: "The gallery", url: "https://gallery.example/hours" }] };

async function setup() {
  const rig = testRig();
  const { sessionId, stamp } = await openTestSession(rig);
  await patchRecord<Session>(rig.store, uid, paths.session(uid, sessionId), { status: "active", callId: "rtc_live", registeredCallIds: ["rtc_live"] });
  const now = rig.clock.read().opsClock.now;
  const at = tsFromMs(now);
  const row: WebSearchEntry = { ...cFields(uid, at, stamp.epoch, stamp.policyRev), kind: "webSearch", at, state: "complete", retainUntil: tsFromMs(now + 3600_000),
    payload: { sessionId, generation: 1, turnId: testId("question"), questionKey: testId("key"), status: "found", findings: [item], query: null, location: null, timezone: "UTC", attempts: 1, leaseUntil: null, offer: null, delivered: false } };
  await rig.store.transaction(uid, async tx => tx.create(paths.ledger(uid, task), row));
  const poll = async (taskAware = true) => {
    const { epoch, policyRev, bundleRev, rulesRev } = stamp;
    const r = await callRoute(rig, stateRoute, { sessionId, generation: 1, seen: { epoch, policyRev, bundleRev, rulesRev },
      ackStamp: null, speechStartedOpsAt: null, includeSpecialists: true, ...(taskAware ? { includeTaskActivity: true } : {}) });
    expect(r.status).toBe(200);
    return r.body;
  };
  let n = 0;
  const receipt = (p: Proactive, kind: string) => callRoute(rig, receiptRoute, { requestId: testId(`receipt-${++n}`), kind, text: null, responseId: "resp_search",
    pendingId: null, permitKind: "proactive", stamp: p.permit.stamp, momentIds: [task], noteIds: p.permit.noteIds });
  const stored = async () => (await rig.store.get<WebSearchEntry>(uid, paths.ledger(uid, task)))!.data.payload;
  return { rig, sessionId, poll, receipt, stored };
}

describe("requested web answers during a voice call", () => {
  it("keeps talking possible and retries an interrupted answer at a later pause", async () => {
    const { rig, poll, receipt, stored } = await setup();
    expect((await poll()).proactive).toBeNull();
    rig.clock.advance(ERRAND_SILENCE_MS + 1);
    expect((await poll(false)).proactive).toBeNull();
    const res = await poll();
    expect(res.webSearch.cards[0]).toMatchObject({ lines: [item.text], citations: item.sources });
    expect(res.proactive).toMatchObject({ source: "webSearch", whisper: { text: expect.stringContaining(item.text) } });
    expect((await poll()).proactive).toBeNull();
    for (const kind of ["admitted", "playbackStarted", "cancelled"]) await receipt(res.proactive, kind);
    await receipt(res.proactive, "playbackStarted");
    await receipt(res.proactive, "playbackEnded");
    expect((await stored()).delivered).toBe(false);
    rig.clock.advance(ERRAND_SILENCE_MS + 1);
    const next = (await poll()).proactive;
    expect(next.turnId).not.toBe(res.proactive.turnId);
    await receipt(res.proactive, "playbackEnded");
    expect((await stored()).delivered).toBe(false);
    await receipt(next, "playbackStarted");
    await receipt(next, "playbackEnded");
    expect((await stored()).delivered).toBe(true);
    rig.clock.advance(60_000);
    expect((await poll()).proactive).toBeNull();
  });

  it("keeps completed results private after an audience change", async () => {
    const { rig, sessionId, poll } = await setup();
    rig.clock.advance(ERRAND_SILENCE_MS + 1);
    await patchRecord<Session>(rig.store, uid, paths.session(uid, sessionId), { audience: "company" });
    const res = await poll();
    expect(res.webSearch).toEqual({ status: "none", cards: [] });
    expect(res.proactive).toBeNull();
  });
});
