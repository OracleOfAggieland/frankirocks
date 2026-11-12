/**
 * Brief 038, new property 4: an old visit cannot talk to the new one. For any run of resets, each with a new visit
 * ID as the browser now sends, with calls of earlier visits landed after them (an open naming an earlier visit, a
 * typed turn on an earlier visit's Session, a bolt naming an earlier namespace):
 * every such call is answered STALE, and the tenant afterwards holds what it held before the call, apart from the
 * call's own request entry, closed as failed.
 *
 * Runs: RUNS (about 26 s alone; 1,000 took about 52 s). Each case resets a small fixture and opens a Session up to
 * nine times.
 */
import { type Ledger, msFromTs, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { openRoute } from "../routes/open";
import { seedAdvanceRoute } from "../routes/seed-advance";
import { seedResetRoute } from "../routes/seed-reset";
import { turnRoute } from "../routes/turn";
import { callRoute, testRig } from "../testing/fakes";
import { SMALL_FIXTURE_ID, snapshotOf } from "../testing/seed";
import { typedTurn } from "../testing/session-fixtures";

const RUNS = 500;
const UID = "owner-1";
const ZONE = "America/Chicago";

type Old = { kind: "open" | "turn" | "advance"; pick: number };
const step = fc.oneof(
  fc.constant({ kind: "newVisit" as const }),
  fc.record({ kind: fc.constantFrom("open" as const, "turn" as const, "advance" as const), pick: fc.nat() }),
);

describe("Property: an old visit cannot talk to the new one (brief 038)", () => {
  it("every call naming an earlier visit is answered STALE and writes nothing but its own failed request entry", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 8 }), async (steps) => {
        const rig = testRig();
        let n = 0;
        type Visit = { visitId: string; ns: string; world: number; stamp: Record<string, unknown> | null };
        const visits: Visit[] = [];
        const newVisit = async () => {
          const visitId = testId(`visit-${++n}`);
          const res = await callRoute(rig, seedResetRoute, { requestId: testId(`req-${++n}`), sessionId: null, fixtureId: SMALL_FIXTURE_ID, visitId, clientZone: ZONE });
          expect(res.status).toBe(200);
          const open = await callRoute(rig, openRoute, { requestId: testId(`open-${++n}`), initiator: "user", previousSessionId: null, clientZone: ZONE, visitId });
          expect(open.status).toBe(200);
          const d = open.body.deck;
          const stamp = { sessionId: open.body.sessionId, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: 1 };
          visits.push({ visitId, ns: res.body.fixtureNamespace, world: msFromTs(res.body.worldClock), stamp });
        };
        await newVisit();
        for (const s of steps) {
          if (s.kind === "newVisit") {
            await newVisit();
            continue;
          }
          const old = visits.slice(0, -1);
          if (old.length === 0) continue;
          const v = old[(s as Old).pick % old.length]!;
          const before = await snapshotOf(rig.store, UID);
          const requestId = testId(`old-${++n}`);
          let res: { status: number; body: any };
          if (s.kind === "open") res = await callRoute(rig, openRoute, { requestId, initiator: "user", previousSessionId: null, clientZone: ZONE, visitId: v.visitId });
          else if (s.kind === "turn") res = await callRoute(rig, turnRoute, { ...typedTurn(v.stamp as never, 1, "A line from an old tab."), requestId });
          else res = await callRoute(rig, seedAdvanceRoute, { requestId, fixtureNamespace: v.ns, to: tsFromMs(v.world + 3_600_000) });
          expect([s.kind, res.status, res.body.error]).toEqual([s.kind, 409, "STALE"]);
          const after = await snapshotOf(rig.store, UID);
          const was = new Map(before);
          const changed = after.filter(([p, json]) => was.get(p) !== json);
          // Only the call's own request entry, closed as failed.
          expect(changed.length, JSON.stringify(changed.map(([p]) => p))).toBeLessThanOrEqual(1);
          for (const [, json] of changed) {
            const entry = JSON.parse(json) as Ledger;
            expect(entry.kind).toBe("request");
            expect(entry.state).toBe("failed");
          }
          expect(after.length - before.length).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: RUNS },
    );
  }, 600_000);
});
