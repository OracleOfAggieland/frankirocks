import { type CoreBundle, type Session, StateResponse, type Turn, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { never } from "../openai/fake";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { callRoute, patchRecord, runScheduled, testRig } from "../testing/fakes";
import { openRoute } from "./open";
import { stateRoute } from "./state";
import { turnRoute } from "./turn";

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
  it("keeps the voice acknowledgment available when optional task queries fail", async () => {
    const { rig, body } = await opened();
    const transaction = rig.store.transaction.bind(rig.store);
    rig.store.transaction = (uid, fn) => transaction(uid, async (tx) => {
      const query: Tx["query"] = (spec) => {
        if (spec.where.some((f) => f.field === "kind" && (f.value === "webSearch" || f.value === "phoneCall"))) throw new Error("index not available");
        return tx.query(spec);
      };
      return fn({ ...tx, query });
    });
    const res = await callRoute(rig, stateRoute, body({ includeSpecialists: true, includeTaskActivity: true }));
    expect(res.status).toBe(200);
    expect(res.body.ack).not.toBeNull();
    expect(res.body).toMatchObject({ phoneActivity: [], webSearch: { status: "none", cards: [] } });
    expect(validate(StateResponse, res.body).ok).toBe(true);
  });

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

const typed = (sessionId: string, deck: { epoch: number; policyRev: number; bundleRev: number; rulesRev: number }, n: number, text: string) => ({
  sessionId,
  epoch: deck.epoch,
  policyRev: deck.policyRev,
  bundleRev: deck.bundleRev,
  rulesRev: deck.rulesRev,
  generation: 1,
  turnId: testId(`turn-${n}`),
  requestId: testId(`req-${n}`),
  clientSeq: n,
  source: "typed",
  items: [],
  utteredWorldAt: "2026-11-03T12:00:00.000Z",
  transcript: text,
  transcriptState: "final",
  judge: "typed",
  pendingId: null,
  choiceId: null,
  supersedesRequestId: null,
  uiControl: null,
});

describe("POST /api/session/state, voice-control (task 34)", () => {

  it("no ack while an S2 user Turn is among the last four (R4.2)", async () => {
    const { rig, sessionId, deck, body } = await opened();
    await callRoute(rig, turnRoute, typed(sessionId, deck, 1, "hello"));
    expect((await callRoute(rig, stateRoute, body())).body.ack).not.toBeNull();
    const path = paths.turn(UID, sessionId, testId("turn-1"));
    const t = (await rig.store.get<Turn>(UID, path))!.data;
    await patchRecord<Turn>(rig.store, UID, path, { rootSlices: t.rootSlices.map((s) => ({ ...s, sens: "S2" as const })) });
    expect((await callRoute(rig, stateRoute, body())).body.ack).toBeNull();
    for (const n of [2, 3, 4, 5]) await callRoute(rig, turnRoute, typed(sessionId, deck, n, `line ${n}`));
    expect((await callRoute(rig, stateRoute, body())).body.ack).not.toBeNull();
  });

  it("no ack with a parse gap, or while a lease holds; an expired lease stores unknown", async () => {
    const gap = await opened();
    await patchRecord<Session>(gap.rig.store, UID, paths.session(UID, gap.sessionId), { lastClientSeq: 2, committedParseSeq: 1 });
    expect((await callRoute(gap.rig, stateRoute, gap.body())).body.ack).toBeNull();

    const lease = await opened();
    const until = new Date(lease.rig.clock.read().opsClock.now + 2_500).toISOString();
    await patchRecord<Session>(lease.rig.store, UID, paths.session(UID, lease.sessionId), { parseLease: { clientSeq: 1, token: testId("tok"), until } });
    expect((await callRoute(lease.rig, stateRoute, lease.body())).body.ack).toBeNull();
    lease.rig.clock.advance(3_000);
    expect((await callRoute(lease.rig, stateRoute, lease.body())).body.ack).toBeNull();
    const s = (await lease.rig.store.get<Session>(UID, paths.session(UID, lease.sessionId)))!.data;
    expect([s.audience, s.parseLease]).toEqual(["unknown", null]);
  });

  it("polling once a second writes the Session only when something changes (question 84)", async () => {
    const { rig, sessionId, body } = await opened();
    await callRoute(rig, stateRoute, body()); // minting → active: a write
    const rev = (await rig.store.get<Session>(UID, paths.session(UID, sessionId)))!.data.rev;
    for (let i = 0; i < 60; i++) {
      rig.clock.advance(1_000);
      expect((await callRoute(rig, stateRoute, body())).body.ack).not.toBeNull();
    }
    const after = (await rig.store.get<Session>(UID, paths.session(UID, sessionId)))!.data.rev;
    expect(after - rev).toBeLessThanOrEqual(2);
  });
});

describe("POST /api/session/state, the Deck's safe turns (review of wave A, item 2)", () => {
  it("the Deck carries the Session's current safe turns, the last four, without S2", async () => {
    const { rig, sessionId, deck, body } = await opened();
    expect((await callRoute(rig, stateRoute, body())).body.deck.turns).toEqual([]);
    for (const n of [1, 2, 3, 4, 5]) await callRoute(rig, turnRoute, typed(sessionId, deck, n, `line ${n}`));
    const res = await callRoute(rig, stateRoute, body());
    expect(validate(StateResponse, res.body).ok).toBe(true);
    expect(res.body.deck.turns.map((t: { text: string }) => t.text)).toEqual(["line 2", "line 3", "line 4", "line 5"]);
    // An S2 line leaves the Deck (and the ack goes, as before).
    await callRoute(rig, turnRoute, typed(sessionId, deck, 6, "my diagnosis came back"));
    const after = await callRoute(rig, stateRoute, body());
    // The window is the last four turns (3 to 6), and turn 6 is S2.
    expect(after.body.deck.turns.map((x: { text: string }) => x.text)).toEqual(["line 3", "line 4", "line 5"]);
    expect(after.body.ack).toBeNull();
  });
});
