import { type CoreBundle, type Session, StateResponse, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { never } from "../openai/fake";
import { paths } from "../store/paths";
import { callRoute, patchRecord, runScheduled, testRig } from "../testing/fakes";
import { openRoute } from "./open";
import { stateRoute } from "./state";

const UID = "owner-1";

async function opened() {
  const rig = testRig();
  const res = await callRoute(rig, openRoute, { requestId: testId("open1"), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: null });
  await rig.sched.runAll();
  const { sessionId, deck } = res.body;
  const body = (overrides: Record<string, unknown> = {}) => ({
    sessionId,
    generation: 1,
    seen: { epoch: deck.epoch, policyRev: deck.policyRev, bundleRev: deck.bundleRev, rulesRev: deck.rulesRev },
    ackStamp: null,
    speechStartedOpsAt: null,
    ...overrides,
  });
  return { rig, sessionId, deck, body };
}

describe("POST /api/session/state", () => {
  it("re-issues Deck every call", async () => {
    const { rig, sessionId, deck, body } = await opened();
    rig.clock.advance(45_000);
    const a = await callRoute(rig, stateRoute, body());
    expect(a.status).toBe(200);
    expect(validate(StateResponse, a.body).ok).toBe(true);
    expect(a.body.deck.issuedAt).toBe("2026-11-03T12:00:45.000Z");
    expect(a.body.deck.expiresAt).toBe("2026-11-03T12:01:45.000Z");
    expect(a.body.deck.head).toEqual(deck.head);
    expect(a.body.ack.issuedOpsAt).toBe("2026-11-03T12:00:45.000Z");
    expect(a.body.ack.expiresOpsAt).toBe("2026-11-03T12:00:47.500Z");
    expect(a.body.stamp).toEqual({ sessionId, epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1 });

    // Past core/bundle.expiresAt (open + 60 s): the Deck is still re-issued from the stored Head (R13.3).
    rig.clock.advance(45_000);
    const b = await callRoute(rig, stateRoute, body());
    expect(b.body.deck.issuedAt).toBe("2026-11-03T12:01:30.000Z");
    expect(b.body.deck.expiresAt).toBe("2026-11-03T12:02:30.000Z");
    const bundle = (await rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data;
    expect(bundle.expiresAt! < b.body.deck.issuedAt).toBe(true);

    const session = (await rig.store.get<Session>(UID, paths.session(UID, sessionId)))!.data;
    expect(session).toMatchObject({ status: "active", expiresAt: "2026-11-03T12:11:30.000Z" });
    expect(session.stateAck).toEqual(b.body.ack);
  });

  it("tick is scheduled, not awaited", async () => {
    const { rig, sessionId, body } = await opened();
    // An older Session with a call that OpenAI never answers, already past its expiry.
    const old = testId("oldsession");
    await rig.store.transaction(UID, async (tx) => {
      const s = (await tx.get<Session>(paths.session(UID, sessionId)))!.data;
      tx.create(paths.session(UID, old), { ...s, status: "active", registeredCallIds: ["rtc_old"], expiresAt: "2026-11-03T12:00:30.000Z" });
    });
    rig.openai.always("realtime.calls.hangup", never());
    rig.clock.advance(61_000);
    const res = await callRoute(rig, stateRoute, body());
    expect(res.status).toBe(200);
    expect(res.elapsedMs).toBeLessThan(1_500);
    expect(rig.sched.pending).toBeGreaterThan(0);
    expect((await rig.store.get<Session>(UID, paths.session(UID, old)))!.data.status).toBe("active");
    await runScheduled(rig);
    expect((await rig.store.get<Session>(UID, paths.session(UID, old)))!.data.status).toBe("closing");
  });

  it("returns STALE for a generation mismatch or a closed Session, and SCOPE for an unknown Session", async () => {
    const { rig, sessionId, body } = await opened();
    expect((await callRoute(rig, stateRoute, body({ generation: 2 }))).body.error).toBe("STALE");
    expect((await callRoute(rig, stateRoute, body({ sessionId: testId("nope") }))).body.error).toBe("SCOPE");
    await patchRecord<Session>(rig.store, UID, paths.session(UID, sessionId), { status: "closed" });
    expect((await callRoute(rig, stateRoute, body())).body.error).toBe("STALE");
  });

  it("keeps no request ledger entry", async () => {
    const { rig, body } = await opened();
    const before = rig.store.countUnder(paths.collection(UID, "ledger"));
    await callRoute(rig, stateRoute, body());
    expect(rig.store.countUnder(paths.collection(UID, "ledger"))).toBe(before);
  });
});
