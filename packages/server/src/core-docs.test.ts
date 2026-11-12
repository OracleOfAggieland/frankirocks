import { CORE_DOCS, type CoreDocId, type Schema, validate } from "@franki/core";
import { describe, expect, it } from "vitest";
import { UnsupportedClockModeError, ensureCoreDocs, initialCoreDocs, ownerClock, readCoreDocs } from "./core-docs";
import { paths } from "./store/paths";
import { testRig } from "./testing/fakes";

const UID = "owner-1";

describe("core documents", () => {
  it("creates all five documents with the design's initial values", async () => {
    const rig = testRig();
    expect(await ensureCoreDocs(UID, rig.deps, "America/Chicago")).toBe(true);
    const docs = await rig.store.transaction(UID, (tx) => readCoreDocs(tx, UID));
    for (const id of Object.keys(CORE_DOCS) as CoreDocId[]) {
      expect(validate(CORE_DOCS[id] as Schema<unknown>, docs[id].data).ok).toBe(true);
    }
    expect(docs.state.data).toMatchObject({ clockMode: "live", currentZone: "America/Chicago", homeZone: "America/Chicago", memoryOn: true });
    expect(docs.epoch.data).toMatchObject({ epoch: 1, policyRev: 1, barrier: null, activeSessionId: null, rev: 1 });
    expect(docs.bundle.data).toMatchObject({ state: "dirty", bundleRev: 0, head: null });
    expect(docs.counters.data.day).toBe("2026-11-03");
  });

  it("falls back to UTC without a valid client zone", () => {
    const rig = testRig();
    expect(initialCoreDocs(UID, rig.clock.read(), "Not/AZone").state.currentZone).toBe("UTC");
    expect(initialCoreDocs(UID, rig.clock.read(), null).state.currentZone).toBe("UTC");
  });

  it("writes nothing when core/epoch already exists", async () => {
    const rig = testRig();
    await ensureCoreDocs(UID, rig.deps);
    rig.clock.advance(1000);
    expect(await ensureCoreDocs(UID, rig.deps, "Europe/Paris")).toBe(false);
    const state = await rig.store.get<{ rev: number; currentZone: string }>(UID, paths.core(UID, "state"));
    expect(state?.data).toMatchObject({ rev: 1, currentZone: "UTC" });
  });

  it("two concurrent first requests create one set", async () => {
    const rig = testRig();
    const results = await Promise.all([ensureCoreDocs(UID, rig.deps), ensureCoreDocs(UID, rig.deps), ensureCoreDocs(UID, rig.deps)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(rig.store.countUnder(`users/${UID}/core`)).toBe(5);
    const epoch = await rig.store.get<{ rev: number }>(UID, paths.core(UID, "epoch"));
    expect(epoch?.data.rev).toBe(1);
  });

  it("live mode: world and ops are the same reading, in core/state's zone", () => {
    const rig = testRig();
    const state = initialCoreDocs(UID, rig.clock.read(), null).state;
    const pair = ownerClock({ ...state, currentZone: "Asia/Tokyo" }, rig.clock);
    expect(pair.worldClock).toEqual({ now: rig.clock.read().opsClock.now, zone: "Asia/Tokyo" });
    expect(pair.opsClock.now).toBe(rig.clock.read().opsClock.now);
  });

  // Brief 019 task 6 replaces the earlier slice's "fixture mode is unsupported" (R6.7): a seeded clone runs on it.
  it("fixture mode: world is core/state.worldClock and stands still while ops stays live", () => {
    const rig = testRig();
    const state = { ...initialCoreDocs(UID, rig.clock.read(), null).state, clockMode: "fixture" as const, worldClock: "2026-10-30T13:40:00.000Z", currentZone: "America/Chicago" };
    const first = ownerClock(state, rig.clock);
    expect(first.worldClock).toEqual({ now: Date.UTC(2026, 9, 30, 13, 40), zone: "America/Chicago" });
    rig.clock.advance(60_000);
    const later = ownerClock(state, rig.clock);
    expect(later.worldClock.now).toBe(first.worldClock.now);
    expect(later.opsClock.now).toBe(first.opsClock.now + 60_000);
  });

  it("fixture mode without a world clock fails closed", () => {
    const rig = testRig();
    const state = initialCoreDocs(UID, rig.clock.read(), null).state;
    expect(() => ownerClock({ ...state, clockMode: "fixture", worldClock: null }, rig.clock)).toThrow(UnsupportedClockModeError);
  });
});
