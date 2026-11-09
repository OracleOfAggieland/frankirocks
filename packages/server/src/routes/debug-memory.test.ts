import { DebugPage, type Memory, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import type { StorePort } from "../store/port";
import { commitUserTurnForTest, insertMemoryForTest } from "../testing/extract-fixtures";
import { type TestRig, callRoute, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
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

  it("lists Turns in seq order and admission entries with issuer devAdmit and the Permit kind", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "first line"));
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 2, "From: x\nsecond"));
    const turns = await get(rig, { section: "turns", sessionId: s.sessionId });
    expect(turns.body.items.map((i: { record: { seq: number } }) => i.record.seq)).toEqual([1, 2]);
    expect((await get(rig, { section: "turns" })).body.items).toHaveLength(2);
    const ledger = await get(rig, { section: "ledger" });
    expect(validate(DebugPage, ledger.body).ok).toBe(true);
    expect(ledger.body.items.map((i: { issuer: string; permitKind: string }) => [i.issuer, i.permitKind]).sort()).toEqual([
      ["devAdmit", "postCommitControl"],
      ["devAdmit", "slowOrdinary"],
    ]);
    const head = await get(rig, { section: "head" });
    expect(head.body.items[0]).toMatchObject({ kind: "head", id: "bundle", record: { bundleRev: 1, state: "clean" } });
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
