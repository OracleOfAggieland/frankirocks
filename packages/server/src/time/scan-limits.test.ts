// Brief 036 finding 15 (a known limit, pinned): moment rows are never deleted. Past MOMENT_SCAN_MAX rows the tick
// opens nothing for that owner and says so in a log line, and chooseNow speaks nothing; a jump moves at most
// TICK_PAGE moments per tick, and the next tick moves the rest. Fine at demo size.
import { localMinuteAt, momentRow, type MomentPlan } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { testRig, type TestRig } from "../testing/fakes";
import { chooseNow } from "./proactive";
import { momentsOf, timeTenant } from "./testing";
import { MOMENT_SCAN_MAX, TICK_PAGE, memoryTick } from "./tick";

const UID = "owner-1";
const ZONE = "America/Chicago";
const DAY = "2026-11-13";

/** `n` pending reminder-like moments due at `dueAt`, written straight to the store (test setup only). */
async function fill(rig: TestRig, n: number, dueAt: number): Promise<void> {
  const ops = rig.clock.read().opsClock.now;
  await rig.store.transaction(UID, async (tx) => {
    for (let i = 0; i < n; i++) {
      const id = testId(`filler-${i}`);
      const plan: MomentPlan = {
        momentId: id,
        source: { kind: "action", id: testId(`filler-action-${i}`) },
        kind: "commitmentDue",
        occurrenceKey: DAY,
        scheduleRev: 0,
        dueAt,
        closeAt: dueAt + 86_400_000,
        domain: "time",
        subjectIds: ["self"],
        payload: { kind: "cue", noteRef: { type: "ledger", id: testId(`filler-action-${i}`), rev: 1 }, template: null },
        noteRef: null,
        lineage: { rootKeys: [], rootSlices: [], dependsOn: [] },
      };
      tx.create(paths.moment(UID, id), momentRow(plan, { uid: UID, opsNow: ops, epoch: 1, policyRev: 1, clockMode: "fixture" }, rig.deps.hasher));
    }
  });
}

describe("finding 15: the scan and page limits fail quiet", () => {
  it(`past ${MOMENT_SCAN_MAX} moment rows the tick opens nothing and logs it, and nothing is spoken`, async () => {
    const rig = testRig();
    const world = localMinuteAt(DAY, 9 * 60, ZONE)!;
    const ctx = await timeTenant(rig, UID, ZONE, world);
    await fill(rig, MOMENT_SCAN_MAX + 1, world - 60_000);
    const report = await memoryTick(ctx);
    expect(report.opened).toEqual([]);
    expect(rig.logs).toContainEqual({ event: "time.tickSkipped", fields: { reason: "scanLimit" } });
    expect([...(await momentsOf(rig, UID)).values()].every((m) => m.status === "pending")).toBe(true);
    expect((await chooseNow(ctx, { kind: "opening" }, { transition: false, crisis: false, turnsSinceCheckInAnswer: null })).choice.spoken).toBeNull();
  }, 60_000);

  it(`a tick moves at most ${TICK_PAGE} due moments; the next tick moves the rest`, async () => {
    const rig = testRig();
    const world = localMinuteAt(DAY, 9 * 60, ZONE)!;
    const ctx = await timeTenant(rig, UID, ZONE, world);
    await fill(rig, TICK_PAGE + 5, world - 60_000);
    expect((await memoryTick(ctx)).transitions).toHaveLength(TICK_PAGE);
    expect((await memoryTick(ctx)).transitions).toHaveLength(5);
  }, 60_000);
});
