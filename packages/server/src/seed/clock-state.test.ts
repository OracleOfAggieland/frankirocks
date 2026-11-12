import { type CoreEpoch, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ownerClock } from "../core-docs";
import { paths } from "../store/paths";
import { patchRecord, testRig } from "../testing/fakes";
import { listTenantRows } from "./clear";
import { resetAs, stateOf } from "../testing/seed";
import { setWorldClock } from "./clock-state";

const UID = "owner-1";
const ZONE = "Europe/Berlin";
const DAY = 86_400_000;

describe("setWorldClock", () => {
  it("moves the world clock only: no other row changes", async () => {
    const rig = testRig();
    const reset = await resetAs(rig, UID, "v1", "r1", ZONE);
    const before = (await listTenantRows(rig.store, UID)).filter((r) => !r.path.endsWith("/core/state"));
    const was = await stateOf(rig.store, UID);
    const to = Date.parse(was.worldClock!) + DAY;
    await rig.store.transaction(UID, (tx) => setWorldClock(tx, UID, reset.body.fixtureNamespace, to, rig.clock.read().opsClock.now));
    const state = await stateOf(rig.store, UID);
    expect(state).toEqual({ ...was, worldClock: tsFromMs(to), updatedAt: state.updatedAt, rev: state.rev });
    expect(ownerClock(state, rig.clock).worldClock.now).toBe(to);
    expect((await listTenantRows(rig.store, UID)).filter((r) => !r.path.endsWith("/core/state"))).toEqual(before);
  });

  it("is refused while a barrier is up (KS09), for an old namespace, and on a live account", async () => {
    const rig = testRig();
    const reset = await resetAs(rig, UID, "v1", "r1", ZONE);
    const ns = reset.body.fixtureNamespace;
    const ops = rig.clock.read().opsClock.now;
    const set = (uid: string, n: string) => rig.store.transaction(uid, (tx) => setWorldClock(tx, uid, n, ops + DAY, ops));
    await expect(set(UID, testId("old-ns"))).rejects.toMatchObject({ code: "STALE" });
    const now = tsFromMs(ops);
    await patchRecord<CoreEpoch>(rig.store, UID, paths.core(UID, "epoch"), { barrier: { opId: testId("forget"), phase: "fence", startedAt: now, deadline: now, queuedOps: [] } });
    await expect(set(UID, ns)).rejects.toMatchObject({ code: "BARRIER" });
    const other = testRig();
    await resetAs(other, "owner-2", "v1", "r1", ZONE).catch(() => undefined);
    await patchRecord(other.store, "owner-2", paths.core("owner-2", "state"), { clockMode: "live", worldClock: null });
    await expect(other.store.transaction("owner-2", (tx) => setWorldClock(tx, "owner-2", ns, ops, ops))).rejects.toMatchObject({ code: "STALE" });
  });
});
