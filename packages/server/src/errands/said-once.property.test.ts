// Brief 049 property "Said once" (part A, ruling 9): however many state polls race for a ready result, in whatever
// order and at whatever times, and however many extra runners start, the result is offered at most once, exactly
// once when the call is quiet, its Session open and its epoch unchanged; and the one decision row exists exactly
// once. Seed and counterexample recorded in brief 049's report.
import { ERRAND_SILENCE_MS, type Ledger } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runRoute } from "../routes/runtime";
import { stateRoute } from "../routes/state";
import { toolRoute } from "../routes/tool";
import { paths } from "../store/paths";
import { ERRAND_OWNER as UID, errandOf, errandSetup, poll, tool } from "../testing/errand-agent";
import { callRoute, fakeRequest, runScheduled, settle } from "../testing/fakes";
import { errandDeliveryId, errandIdOf } from "./records";
import { runErrand } from "./run";

const LINE = "The plumber comes Thursday at 9.";

describe("property: said once (brief 049)", () => {
  it("200 runs", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Waves of concurrent polls, each wave after a wait; extra runners started between waves.
        fc.array(fc.record({ polls: fc.integer({ min: 1, max: 4 }), waitMs: fc.integer({ min: 0, max: 3_000 }), runners: fc.integer({ min: 0, max: 2 }) }), { minLength: 1, maxLength: 5 }),
        async (waves) => {
          const x = await errandSetup([{ call: "search_mail" }, { outcome: "answered", lines: [{ text: LINE, refs: ["r1"] }] }]);
          await callRoute(x.rig, toolRoute, tool(x));
          await runScheduled(x.rig);
          const id = errandIdOf(x.rig.deps.hasher, x.sessionId, x.stamp.turnId);
          const ctx = { uid: UID, deps: x.rig.deps, schedule: x.rig.sched.schedule };
          const quietFrom = x.rig.clock.read().opsClock.now;
          let said = 0;
          let quietSeen = false;
          for (const w of waves) {
            x.rig.clock.advance(w.waitMs);
            if (x.rig.clock.read().opsClock.now - quietFrom >= ERRAND_SILENCE_MS) quietSeen = true;
            const work = Promise.all([
              ...Array.from({ length: w.polls }, () => runRoute(stateRoute, fakeRequest({ body: poll(x) }), x.rig.deps, x.rig.sched.schedule)),
              ...Array.from({ length: w.runners }, () => runErrand(ctx, id)),
            ]);
            const { value } = await settle(work, x.rig.clock, x.rig.timers);
            for (const r of value.slice(0, w.polls) as { status: number; body: any }[]) {
              if (r.status === 200 && r.body.proactive?.whisper.momentId === id) {
                said++;
                expect(r.body.proactive.whisper.text).toContain(LINE);
              }
            }
            await runScheduled(x.rig);
          }
          expect(said).toBeLessThanOrEqual(1);
          const decision = await x.rig.store.get<Ledger>(UID, paths.ledger(UID, errandDeliveryId(x.rig.deps.hasher, id)));
          expect(decision !== null).toBe(said === 1);
          // A quiet poll of the open Session found it: it was said, and the Errand is delivered.
          if (quietSeen) {
            expect(said).toBe(1);
            expect((await errandOf(x))?.status).toBe("delivered");
          }
        },
      ),
      { numRuns: 200 },
    );
  }, 600_000);
});
