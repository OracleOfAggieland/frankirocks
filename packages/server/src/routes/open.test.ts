import { type CoreBundle, type CoreEpoch, type Job, type Session, utf8, validate, OpenResponse } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { fail, ok } from "../openai/fake";
import { paths } from "../store/paths";
import { commitUserTurnForTest, insertMemoryForTest } from "../testing/extract-fixtures";
import { callRoute, patchRecord, testRig } from "../testing/fakes";
import { hangupJobId } from "../worker/hangup";
import { openRoute } from "./open";

const UID = "owner-1";
const openBody = (n: number | string, overrides: Record<string, unknown> = {}) => ({
  requestId: testId(`open${n}`),
  initiator: "user",
  previousSessionId: null,
  clientZone: "America/Chicago",
  visitId: null,
  ...overrides,
});

const get = async <T>(rig: ReturnType<typeof testRig>, path: string) => (await rig.store.get<T>(UID, path))?.data ?? null;

describe("POST /api/session/open", () => {
  it("one transaction writes bundle and session with post-compile bundleRev", async () => {
    const rig = testRig();
    const res = await callRoute(rig, openRoute, openBody(1));
    expect(res.status).toBe(200);
    expect(validate(OpenResponse, res.body).ok).toBe(true);
    const { sessionId, deck, ack } = res.body;
    expect(res.body).toMatchObject({ generation: 1, state: "connecting", proactive: null });

    const bundle = (await get<CoreBundle>(rig, paths.core(UID, "bundle")))!;
    const session = (await get<Session>(rig, paths.session(UID, sessionId)))!;
    const epoch = (await get<CoreEpoch>(rig, paths.core(UID, "epoch")))!;
    expect(bundle).toMatchObject({ state: "clean", bundleRev: 1, compiledAt: "2026-11-03T12:00:00.000Z" });
    expect(bundle.head).toEqual(deck.head);
    expect(bundle.headHash).toBe(rig.deps.hasher.sha256(utf8(deck.head.text)));
    expect(deck.bundleRev).toBe(1);
    expect(ack.stamp.bundleRev).toBe(1);
    expect(session.stateAck?.stamp.bundleRev).toBe(1);
    expect(session).toMatchObject({ status: "minting", generation: 1 });
    expect(epoch.activeSessionId).toBe(sessionId);
    expect(deck.expiresAt).toBe("2026-11-03T12:01:00.000Z");
    expect(deck.issuedAt).toBe("2026-11-03T12:00:00.000Z");
    expect(ack.expiresOpsAt).toBe("2026-11-03T12:00:02.500Z");
    expect(deck.head.sections).toHaveLength(10);
  });

  it("a failed transaction commits nothing and leaves core/bundle unchanged (R26.11)", async () => {
    const rig = testRig();
    await callRoute(rig, openRoute, openBody(1));
    const before = await get<CoreBundle>(rig, paths.core(UID, "bundle"));
    // Fail only the transaction that writes core/bundle; the ledger begin and release still commit.
    rig.deps.store = {
      get: (uid, path) => rig.store.get(uid, path),
      query: (uid, spec) => rig.store.query(uid, spec),
      transaction: (uid, fn) =>
        rig.store.transaction(uid, async (tx) => {
          let writesBundle = false;
          const watched = {
            ...tx,
            get: tx.get,
            query: tx.query,
            create: tx.create,
            update: (path: string, record: object, expectRev?: number) => {
              if (path === paths.core(UID, "bundle")) writesBundle = true;
              tx.update(path, record, expectRev);
            },
          };
          const r = await fn(watched);
          if (writesBundle) throw new Error("injected commit failure");
          return r;
        }),
    };
    const res = await callRoute(rig, openRoute, openBody(2));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("DEPENDENCY");
    expect(await get(rig, paths.core(UID, "bundle"))).toEqual(before);
    expect(rig.store.countUnder(paths.collection(UID, "sessions"))).toBe(1);
  });

  it("barrier → blocked: no Session, activeSessionId and the prior Session unchanged (R11.6)", async () => {
    const rig = testRig();
    const first = await callRoute(rig, openRoute, openBody(1));
    const barrier = { opId: testId("op"), phase: "fence", startedAt: "2026-11-03T12:00:00.000Z", deadline: "2026-11-03T12:05:00.000Z", queuedOps: [] };
    await patchRecord<CoreEpoch>(rig.store, UID, paths.core(UID, "epoch"), { barrier } as Partial<CoreEpoch>);
    const priorBefore = await get<Session>(rig, paths.session(UID, first.body.sessionId));
    const res = await callRoute(rig, openRoute, openBody(2));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "blocked", deck: null, ack: null });
    expect(rig.store.countUnder(paths.collection(UID, "sessions"))).toBe(1);
    expect((await get<CoreEpoch>(rig, paths.core(UID, "epoch")))!.activeSessionId).toBe(first.body.sessionId);
    expect(await get(rig, paths.session(UID, first.body.sessionId))).toEqual(priorBefore);
  });

  it("closes the prior Session before returning, hanging up its calls (R11.3)", async () => {
    const rig = testRig();
    rig.openai.always("realtime.calls.hangup", ok(null));
    const first = await callRoute(rig, openRoute, openBody(1));
    await patchRecord<Session>(rig.store, UID, paths.session(UID, first.body.sessionId), { status: "active", registeredCallIds: ["rtc_a", "rtc_b"], callId: "rtc_b" });
    const second = await callRoute(rig, openRoute, openBody(2));
    expect(second.body.state).toBe("connecting");
    expect((await get<Session>(rig, paths.session(UID, first.body.sessionId)))!.status).toBe("closed");
    expect(rig.openai.requestsTo("realtime.calls.hangup").map((r) => (r.body as { callId: string }).callId).sort()).toEqual(["rtc_a", "rtc_b"]);
    expect((await get<CoreEpoch>(rig, paths.core(UID, "epoch")))!.activeSessionId).toBe(second.body.sessionId);
    expect((await get<CoreBundle>(rig, paths.core(UID, "bundle")))!.bundleRev).toBe(2);
    expect(second.body.deck.bundleRev).toBe(2);
  });

  it("marks the prior Session closed even when its hangup fails, and records a hangup Job (R11.3)", async () => {
    const rig = testRig();
    rig.openai.always("realtime.calls.hangup", fail(new Error("openai down")));
    const first = await callRoute(rig, openRoute, openBody(1));
    await patchRecord<Session>(rig.store, UID, paths.session(UID, first.body.sessionId), { status: "active", registeredCallIds: ["rtc_a"] });
    await callRoute(rig, openRoute, openBody(2));
    expect((await get<Session>(rig, paths.session(UID, first.body.sessionId)))!.status).toBe("closed");
    const job = await get<Job>(rig, paths.job(UID, hangupJobId(first.body.sessionId, rig.deps.hasher)));
    expect(job).toMatchObject({ kind: "hangup", status: "queued" });
  });

  it("replays the original response for a repeated requestId and creates no second Session (R11.9)", async () => {
    const rig = testRig();
    const a = await callRoute(rig, openRoute, openBody(1));
    rig.clock.advance(5_000);
    const b = await callRoute(rig, openRoute, openBody(1));
    expect(b.body).toEqual(a.body);
    expect(rig.store.countUnder(paths.collection(UID, "sessions"))).toBe(1);
    const c = await callRoute(rig, openRoute, openBody(1, { clientZone: "Europe/Paris" }));
    expect([c.status, c.body.error]).toEqual([409, "HASH"]);
  });

  it.each([
    ["an unknown field", openBody(1, { extra: true })],
    ["a missing clientZone", (({ clientZone: _z, ...rest }) => rest)(openBody(1))],
    ["a missing requestId", (({ requestId: _r, ...rest }) => rest)(openBody(1))],
    ["an invalid IANA zone", openBody(1, { clientZone: "Mars/Olympus" })],
  ])("rejects %s with PARSE and creates no Session (R11.8)", async (_label, body) => {
    const rig = testRig();
    const res = await callRoute(rig, openRoute, body);
    expect(res).toMatchObject({ status: 400, body: { error: "PARSE" } });
    expect(rig.store.countUnder(paths.collection(UID, "sessions"))).toBe(0);
  });

  it("rejects a bad token with AUTH and writes nothing (R11.7)", async () => {
    const rig = testRig();
    const res = await callRoute(rig, openRoute, openBody(1), { token: "nope" });
    expect(res.status).toBe(401);
    expect(rig.store.countUnder(`users/${UID}/core`)).toBe(0);
  });

  it("puts an eligible Memory in the Head and sets currentZone from clientZone", async () => {
    const rig = testRig();
    await callRoute(rig, openRoute, openBody(1));
    const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), "My dog is called Pip", rig.clock, rig.deps.hasher);
    const mid = await insertMemoryForTest(rig.store, UID, turn, rig.deps.hasher);
    const res = await callRoute(rig, openRoute, openBody(2, { clientZone: "Europe/Paris" }));
    expect(res.body.deck.head.text).toContain("My dog is called Pip");
    expect(res.body.deck.head.selectedRefs).toEqual([{ type: "memory", id: mid, rev: 1 }]);
    expect(res.body.deck.head.text).toContain("Europe/Paris");
  });

  it("returns within 5 s on opsClock (R11.2)", async () => {
    const rig = testRig();
    const res = await callRoute(rig, openRoute, openBody(1));
    expect(res.elapsedMs).toBeLessThan(5_000);
  });
});
