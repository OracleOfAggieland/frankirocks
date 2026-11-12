// Brief 041 follow-up W-229: what part 3's life check costs one delivery pass. One pass is what `deliverOnce` does:
// `chooseNow`, then the render in `proactiveOf`. Every store call is counted: each `get` and `query`, top level or
// in a transaction, and each commit; a scan is a page query over the memories collection by document ID.
//
// Measured, one pass, before W-229 (a source read and a whole-Memory scan per moment that reached the life check)
// and after (one view per reader: one scan for `chooseNow`, one in the render's own transaction):
//
//   seeded persona (its wish and the hero insight leased, rooted in the owner only): 36 calls and 0 scans before,
//   36 calls and 2 scans after (the source read each moment made is now the view; a tenant past 100 Memories pays
//   one more page per 100);
//   three wishes about Mom: 44 calls and 4 scans before (3 in `chooseNow`), 38 calls and 2 scans after (1).
//
// The render rereads in its own transaction (`time/proactive.ts`, the wire lane's file), so a pass reads the view
// twice; one read per pass would need the render to reuse the choice's reader (W-229).
import { localMinuteAt } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import type { QuerySpec, Reader, StorePort } from "../store/port";
import { type TestRig, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { chooseNow, proactiveOf } from "./proactive";
import { setWorld, timeTenant, writeOccasion } from "./testing";
import { memoryTick } from "./tick";

const UID = "owner-1";
const ZONE = "America/Chicago";
const DAY = "2026-11-13";
const MOM = testId("mom");
const STAMP = { sessionId: testId("s"), epoch: 2, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1, turnId: testId("t") };
const QUIET = { transition: false, crisis: false, turnsSinceCheckInAnswer: null };

interface Count {
  calls: number;
  scans: number;
}

function counting(inner: StorePort) {
  const n: Count = { calls: 0, scans: 0 };
  const seen = (spec: QuerySpec) => {
    if (spec.collection === paths.collection(UID, "memories") && spec.where.every((w) => w.field === "__name__")) n.scans++;
  };
  const wrap = (r: Reader): Reader => ({
    get: (p) => (n.calls++, r.get(p)),
    query: (q) => (n.calls++, seen(q), r.query(q)),
  });
  const store: StorePort = {
    get: (uid, p) => (n.calls++, inner.get(uid, p)),
    query: (uid, q) => (n.calls++, seen(q), inner.query(uid, q)),
    transaction: (uid, fn) =>
      inner.transaction(uid, async (tx) => {
        const r = await fn({ ...tx, ...wrap(tx) });
        n.calls++;
        return r;
      }),
  };
  return { store, n };
}

/** One delivery pass over the tenant, counted. */
async function pass(rig: TestRig, label: string): Promise<{ all: Count; choice: Count }> {
  const { store, n } = counting(rig.deps.store);
  const ctx: RouteContext = { uid: UID, deps: { ...rig.deps, store }, schedule: () => undefined };
  const { choice, moments } = await chooseNow(ctx, { kind: "opening" }, QUIET);
  const inChoice = { ...n };
  expect(choice.spoken).not.toBeNull();
  const id = choice.spoken!.momentId as never;
  expect(await proactiveOf(ctx, id, moments.get(id)!, STAMP)).not.toBeNull();
  const out = process.env.W217_OUT;
  if (out !== undefined) (await import("node:fs")).appendFileSync(out, `${label}: ${n.calls} calls, ${n.scans} scans; chooseNow ${inChoice.calls} calls, ${inChoice.scans} scans\n`);
  return { all: { ...n }, choice: inChoice };
}

/** The seeded persona, ticked: its wish and the hero insight are leased; both are rooted in the owner only. */
async function seeded(): Promise<TestRig> {
  const rig = testRig();
  await resetAs(rig, UID, "v1", "r1", ZONE);
  await memoryTick({ uid: UID, deps: rig.deps, schedule: () => undefined });
  return rig;
}

/** A small tenant with three occasions about Mom, their three wishes leased at 08:00. */
async function aboutMom(): Promise<TestRig> {
  const rig = testRig();
  const ctx = await timeTenant(rig, UID, ZONE, localMinuteAt(DAY, 6 * 60, ZONE)!);
  for (const [i, minute] of [9 * 60, 9 * 60 + 30, 10 * 60].entries()) {
    await writeOccasion(rig, UID, `mom-${i}`, localMinuteAt(DAY, minute, ZONE)!, ZONE, { value: { kind: "text", text: `Mom's appointment ${i}` }, entityIds: [MOM] });
  }
  await setWorld(rig, UID, localMinuteAt(DAY, 8 * 60, ZONE)!);
  await memoryTick(ctx);
  return rig;
}

describe("the life check's cost in one delivery pass (W-229)", () => {
  // 38, not W-229's 36: brief 042 item 2 reads the two answer rows a moment's kind can have, together, so an
  // answered offer is never offered again. Two calls a pass, and no scan.
  it("the seeded persona: 38 calls (36 for the life check, 2 for the answered-offer check), at most one Memory scan per reader", async () => {
    const { all, choice } = await pass(await seeded(), "seeded");
    expect(choice.scans).toBeLessThanOrEqual(1);
    expect(all.scans).toBeLessThanOrEqual(2);
    expect(all.calls).toBeLessThanOrEqual(38);
  });

  it("three moments about Mom: 38 calls (44 before), one Memory scan in chooseNow (3 before)", async () => {
    const { all, choice } = await pass(await aboutMom(), "mom");
    expect(choice.scans).toBe(1);
    expect(all.scans).toBeLessThanOrEqual(2);
    expect(all.calls).toBeLessThanOrEqual(38);
  });
});
