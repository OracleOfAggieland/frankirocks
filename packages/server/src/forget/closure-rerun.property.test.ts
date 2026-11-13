// Feature: forget, part two (brief 047): closure can be re-run. For any forget and any step re-run after a lost lease
// (the worker dies after reading, before its commit lands, and the lease expires), the store ends the same as a run
// with no loss, apart from times, revisions and lease bookkeeping.
import { type ID, canonicalJSON } from "@franki/core";
import { nrWorldArb } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fakeCallClose } from "./close-port";
import { FORGET_LEASE_MS, advanceForget, requeueExpiredForget } from "./executor";
import { WORLD_UID, allDone, dumpStore, forgetJobsOf, forgetMemory, losingStore, stepAll, storeWorld, worldResolver } from "./testing/world";

const VOLATILE = new Set(["rev", "createdAt", "updatedAt", "at", "startedAt", "deadline", "leaseToken", "leaseUntil", "generation", "attempts", "nextAttemptAt", "error", "blockedAt", "cleanupCompleteAt", "purgedAt", "compiledAt", "expiresAt", "queuedOpsAt", "reviewAt", "head", "headHash"]);
const strip = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(strip);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.has(k)).map(([k, x]) => [k, strip(x)]));
  return v;
};

async function finalStore(w: Parameters<typeof storeWorld>[0], lostAt: number | null) {
  const s = await storeWorld(w);
  const { store, hasher, clock } = s.rig.deps;
  const closer = fakeCallClose(() => "closed");
  const fenced = await forgetMemory(s, w.target, "rerun-1");
  expect(fenced.kind).toBe("fenced");
  for (let step = 0; step < 200 && !(await allDone(store)); step++) {
    if (step === lostAt) {
      for (const j of await forgetJobsOf(store)) {
        await advanceForget({ store: losingStore(store), hasher, resolver: worldResolver(s), closer }, WORLD_UID, j.id as ID, clock.read().opsClock.now, { maxSteps: 1 }).catch(() => null);
        s.rig.clock.advance(FORGET_LEASE_MS + 1);
        await requeueExpiredForget(store, WORLD_UID, j.id as ID, clock.read().opsClock.now);
      }
    }
    await stepAll(s, closer);
  }
  expect(await allDone(store)).toBe(true);
  const dump = await dumpStore(store);
  return new Map([...dump].map(([k, v]) => [k, canonicalJSON(strip(v))]));
}

describe("closure can be re-run (brief 047)", () => {
  it("a step lost with its lease and run again leaves the same store", async () => {
    await fc.assert(
      fc.asyncProperty(nrWorldArb, fc.integer({ min: 0, max: 20 }), async (w, lostAt) => {
        const clean = await finalStore(w, null);
        const lost = await finalStore(w, lostAt);
        expect([...lost.keys()].sort()).toEqual([...clean.keys()].sort());
        for (const [k, v] of clean) expect(lost.get(k), k).toBe(v);
      }),
      { numRuns: 150 },
    );
  }, 600_000);
});
