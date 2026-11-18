import { DebugPage, type Memory, turnRef, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { admitRule, recordFastO } from "../admission/seam";
import type { StorePort } from "../store/port";
import { commitUserTurnForTest, insertMemoryForTest } from "../testing/extract-fixtures";
import { type TestRig, callRoute, testRig } from "../testing/fakes";
import { meetAlreadyHappened, meetRowIds } from "../testing/meet";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { debugMemoryRoute } from "./debug-memory";
import { turnRoute } from "./turn";

const UID = "owner-1";

function get(rig: TestRig, query: Record<string, string>, token?: string) {
  const url = `http://localhost:3000/api/debug/memory?${new URLSearchParams(query).toString()}`;
  return callRoute(rig, debugMemoryRoute, undefined, { method: "GET", url, origin: null, ...(token === undefined ? {} : { token }) });
}

async function pages(rig: TestRig, section: string): Promise<string[][]> {
  const out: string[][] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const res = await get(rig, cursor === null ? { section } : { section, cursor });
    expect(res.status).toBe(200);
    expect(validate(DebugPage, res.body).ok).toBe(true);
    out.push(res.body.items.map((x: { id: string }) => x.id));
    expect(res.body.items.length).toBeLessThanOrEqual(50);
    cursor = res.body.nextCursor;
    if (cursor === null) return out;
  }
  throw new Error("paging did not end");
}

describe("GET /api/debug/memory", () => {
  it("paging with no repeats: 50 per page, nextCursor exactly while more remain", async () => {
    const rig = testRig();
    for (let n = 0; n < 120; n++) await commitUserTurnForTest(rig.store, UID, testId(`t${n}`), `line ${n}`, rig.clock, rig.deps.hasher);
    for (const section of ["evidence", "jobs"]) {
      const p = await pages(rig, section);
      expect(p.map((ids) => ids.length)).toEqual([50, 50, 20]);
      const all = p.flat();
      expect(new Set(all).size).toBe(120);
      expect(all).toEqual([...all].sort());
    }
  });

  it("an exact multiple of 50 ends with no nextCursor on the last full page", async () => {
    const rig = testRig();
    for (let n = 0; n < 50; n++) await commitUserTurnForTest(rig.store, UID, testId(`t${n}`), `line ${n}`, rig.clock, rig.deps.hasher);
    expect((await pages(rig, "evidence")).map((p) => p.length)).toEqual([50]);
  });

  it("lists Turns in seq order and admission entries with issuer seam and the Permit kind from the request entry", async () => {
    const rig = testRig();
    // Brief 052: the first meeting is over, so the open says no meet line and writes no meet rows here.
    await meetAlreadyHappened(rig.store, UID, rig.deps.hasher);
    const s = await openTestSession(rig);
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "first line"));
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 2, "From: x\nsecond"));
    const turns = await get(rig, { section: "turns", sessionId: s.sessionId });
    expect(turns.body.items.map((i: { record: { seq: number } }) => i.record.seq)).toEqual([1, 2]);
    expect((await get(rig, { section: "turns" })).body.items).toHaveLength(2);
    const ledger = await get(rig, { section: "ledger" });
    expect(validate(DebugPage, ledger.body).ok).toBe(true);
    // Brief 052: the first meeting's delivery rows are listed too; they are no admission, so they are left out here.
    const meet = meetRowIds(rig.deps.hasher);
    expect(ledger.body.items.filter((i: { id: string }) => !meet.includes(i.id)).map((i: { issuer: string; permitKind: string }) => [i.issuer, i.permitKind]).sort()).toEqual([
      ["seam", "postCommitControl"],
      ["seam", "slowOrdinary"],
    ]);
    expect(ledger.body.session).toBeNull();
    const head = await get(rig, { section: "head" });
    expect(head.body.items[0]).toMatchObject({ kind: "head", id: "bundle", record: { bundleRev: 1, state: "clean" } });
  });

  it("fastO from its key, a false hold derived, decisions grouped by turn with the fastO one played (R13.3, R13.4)", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    const items = (n: number) => [{ itemId: `item_${n}`, commitSeq: n }];
    // Turn 1: judged O and admitted in the browser; the slow path also answers.
    await callRoute(rig, turnRoute, { ...asrTurn(s.stamp, 1, "my dog loves the park", items(1)), judge: "O" });
    const opsNow = rig.clock.read().opsClock.now;
    await rig.store.transaction(UID, (tx) => recordFastO(tx, { uid: UID, stamp: { ...s.stamp, turnId: testId("turn-1") }, responseId: "resp_1", opsNow, core: { epoch: 1, policyRev: 1 }, audience: "private" }, rig.deps));
    // Turn 2: held by the judge, ordinary to the parse: a false hold.
    await callRoute(rig, turnRoute, { ...asrTurn(s.stamp, 2, "the weather is nice today", items(2)), judge: "H" });
    // Turn 3: a missing transcript is a hold-free recoveryOnly.
    await callRoute(rig, turnRoute, asrTurn(s.stamp, 3, "", items(3), "missing"));

    const ledger = await get(rig, { section: "ledger" });
    expect(validate(DebugPage, ledger.body).ok).toBe(true);
    const rows = ledger.body.items.map((i: { turnId: string; issuer: string; permitKind: string; falseHold: boolean; played: boolean }) => [i.turnId, i.issuer, i.permitKind, i.falseHold, i.played]);
    const t1 = rows.filter((r: unknown[]) => r[0] === testId("turn-1"));
    expect(t1).toEqual(
      expect.arrayContaining([
        [testId("turn-1"), "browser", "fastO", false, true],
        [testId("turn-1"), "seam", "slowOrdinary", false, false],
      ]),
    );
    expect(rows.filter((r: unknown[]) => r[0] === testId("turn-2"))).toEqual([[testId("turn-2"), "seam", "slowOrdinary", true, true]]);
    expect(rows.filter((r: unknown[]) => r[0] === testId("turn-3"))).toEqual([[testId("turn-3"), "seam", "recoveryOnly", false, true]]);
    // Grouped: each Turn's decisions are adjacent.
    const order = rows.map((r: unknown[]) => r[0]);
    for (const id of new Set(order)) {
      const at = order.map((x: unknown, n: number) => (x === id ? n : -1)).filter((n: number) => n >= 0);
      expect(at[at.length - 1]! - at[0]!).toBe(at.length - 1);
    }
    expect(JSON.stringify(ledger.body)).not.toContain("devAdmit");
  });

  it("a hold has no Permit kind", async () => {
    const rig = testRig();
    // Brief 052: the first meeting is over, so the open says no meet line and writes no meet rows here.
    await meetAlreadyHappened(rig.store, UID, rig.deps.hasher);
    const s = await openTestSession(rig);
    const stamp = { ...s.stamp, turnId: testId("turn-1") };
    const rule = { source: "tool", transcript: "final", judge: "O", parse: { kind: "ordinary" }, regexMatch: false, audience: "private", narrowedHere: false, callLive: true, parseGap: false, noteSens: "none", wordsPer2s: true, allFinal: true, toolParseCommitted: false, wave: "A" } as const;
    const input = { uid: UID, requestId: testId("req-t"), requestEntryId: testId("no-entry"), turnRef: turnRef(testId("turn-1"), s.sessionId, 1), core: { epoch: 1, policyRev: 1 }, opsNow: rig.clock.read().opsClock.now, stamp, head: null, notes: [], turns: [], audioIds: [], toolOutput: null, rule };
    const r = await rig.store.transaction(UID, async (tx) => admitRule(tx, input, rig.deps));
    expect(r.kind).toBe("hold");
    const ledger = await get(rig, { section: "ledger" });
    const meet = meetRowIds(rig.deps.hasher);
    expect(ledger.body.items.filter((i: { id: string }) => !meet.includes(i.id)).map((i: { issuer: string; permitKind: string | null; record: { state: string }; played: boolean }) => [i.issuer, i.record.state, i.permitKind, i.played])).toEqual([["seam", "blocked", null, false]]);
  });

  it("the turns section carries the Session view: audience, repair pending, failed parses and the parse gap (R13.5)", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    const items = (n: number) => [{ itemId: `item_${n}`, commitSeq: n }];
    const view = async () => (await get(rig, { section: "turns", sessionId: s.sessionId })).body.session;
    expect(await view()).toEqual({ sessionId: s.sessionId, audience: "private", repairPending: false, failedParses: 0, parseGapTurnId: null });
    await callRoute(rig, turnRoute, asrTurn(s.stamp, 1, "my dog loves the park", items(1)));
    await callRoute(rig, turnRoute, asrTurn(s.stamp, 2, "", items(2), "missing"));
    const v = await view();
    expect(v).toEqual({ sessionId: s.sessionId, audience: "private", repairPending: true, failedParses: 1, parseGapTurnId: testId("turn-2") });
    const page = await get(rig, { section: "turns", sessionId: s.sessionId });
    expect(validate(DebugPage, page.body).ok).toBe(true);
    rig.clock.advance(10_001);
    expect(await view()).toMatchObject({ repairPending: false, parseGapTurnId: testId("turn-2") });
  });

  it("other tenant's ids rejected, and malformed ones are PARSE", async () => {
    const rig = testRig();
    await commitUserTurnForTest(rig.store, UID, testId("mine"), "mine", rig.clock, rig.deps.hasher);
    const theirs = await commitUserTurnForTest(rig.store, "owner-2", testId("theirs"), "theirs", rig.clock, rig.deps.hasher);
    const s2 = await openTestSession(rig, "open-b", "token:owner-2");
    expect((await get(rig, { section: "evidence", cursor: theirs.eid })).body.error).toBe("SCOPE");
    expect((await get(rig, { section: "turns", sessionId: s2.sessionId })).body.error).toBe("SCOPE");
    expect((await get(rig, { section: "evidence", cursor: "../../users/owner-2" })).body.error).toBe("PARSE");
    expect((await get(rig, { section: "nope" })).body.error).toBe("PARSE");
    expect((await get(rig, { section: "evidence", uid: "owner-2" })).body.error).toBe("PARSE");
    // Owner A's page never contains Owner B's records.
    const mine = await get(rig, { section: "evidence" });
    expect(mine.body.items.map((i: { record: { uid: string } }) => i.record.uid)).toEqual([UID]);
  });

  it("requires a valid token", async () => {
    const rig = testRig();
    expect((await get(rig, { section: "head" }, "bad")).status).toBe(401);
  });

  it("S2 reveal logs ids only", async () => {
    const rig = testRig();
    const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), "my diagnosis came back", rig.clock, rig.deps.hasher);
    const mid = await insertMemoryForTest(rig.store, UID, turn, rig.deps.hasher, { sens: "S2" });
    const res = await get(rig, { section: "memories" });
    expect(res.body.items[0].record.value.text).toBe("my diagnosis came back");
    const reveals = rig.logs.filter((l) => l.event === "debug.s2reveal");
    expect(reveals).toEqual([{ event: "debug.s2reveal", fields: { uid: UID, ids: [mid], opsAt: "2026-11-03T12:00:00.000Z" } }]);
    expect(JSON.stringify(rig.logs)).not.toContain("diagnosis");
    // A page with no S2 content logs nothing.
    rig.logs.length = 0;
    await get(rig, { section: "head" });
    expect(rig.logs).toEqual([]);
  });

  it("refuses in production before any read", async () => {
    const rig = testRig();
    let reads = 0;
    const inner = rig.store;
    const counting: StorePort = {
      get: (u, p) => (reads++, inner.get(u, p)),
      query: (u, q) => (reads++, inner.query(u, q)),
      transaction: (u, fn) => (reads++, inner.transaction(u, fn)),
    };
    rig.deps.store = counting;
    rig.deps.env = { ...rig.deps.env, NODE_ENV: "production" };
    const res = await get(rig, { section: "memories" });
    expect(res).toMatchObject({ status: 404, body: { error: "CONFIG", retryAfterMs: 0 } });
    expect(reads).toBe(0);
  });

  it("lineage mismatch flag", async () => {
    const rig = testRig();
    const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), "My dog is called Pip", rig.clock, rig.deps.hasher);
    const good = await insertMemoryForTest(rig.store, UID, turn, rig.deps.hasher, {}, "good");
    const bad = await insertMemoryForTest(rig.store, UID, turn, rig.deps.hasher, {}, "bad");
    // The store refuses a broken lineage at write time, so simulate a corrupted read of one Memory.
    const inner = rig.store;
    rig.deps.store = {
      get: (u, p) => inner.get(u, p),
      transaction: (u, fn) => inner.transaction(u, fn),
      query: async (u, q) =>
        (await inner.query(u, q)).map((d) =>
          d.id === bad ? { ...d, data: { ...(d.data as Memory), rootSlices: (d.data as Memory).rootSlices.map((s) => ({ ...s, contentHash: "f".repeat(64) })) } } : d,
        ) as never,
    };
    const res = await get(rig, { section: "memories" });
    expect(validate(DebugPage, res.body).ok).toBe(true);
    const byId = new Map(res.body.items.map((i: { id: string }) => [i.id, i]));
    expect((byId.get(good) as { lineage: { ok: boolean; links: { text: string }[] } }).lineage).toMatchObject({ ok: true, links: [{ text: "My dog is called Pip" }] });
    const badLineage = (byId.get(bad) as { lineage: { ok: boolean; failures: { kind: string }[] } }).lineage;
    expect(badLineage.ok).toBe(false);
    expect(badLineage.failures.map((f) => f.kind)).toContain("sliceHashMismatch");
  });
});
