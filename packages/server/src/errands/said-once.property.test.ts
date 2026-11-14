// Brief 049 property "Said once" (part A, ruling 9), restated by the director's ruling on review finding V2. The
// first version asserted one offer at the first quiet poll and the Errand `delivered` at once, which pinned the
// defect (a line the browser dropped was lost). The invariant is:
//
//   however many state polls race, in whatever order and at whatever times, however many extra runners start, and
//   whatever the browser does with each offer (plays it and sends its receipt, drops it, or plays it and loses the
//   receipt):
//     1. offers never overlap: each is made only once the one before it has expired;
//     2. after any receipt for any attempt has landed, nothing more is offered, and the Errand is `delivered`;
//     3. nothing is offered past the result's five minutes;
//     4. each offer has its own decision row, and no row exists for an attempt never offered;
//     5. a quiet poll inside the five minutes, with no offer out and no receipt yet, makes an offer;
//     6. so, with no receipt ever lost, the line is played at most once.
//
// Seed and counterexample recorded in brief 049's report.
import { ERRAND_OFFER_MS, ERRAND_RESULT_TTL_MS, ERRAND_SILENCE_MS, type Ledger, msFromTs } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { receiptRoute } from "../routes/receipt";
import { runRoute } from "../routes/runtime";
import { stateRoute } from "../routes/state";
import { toolRoute } from "../routes/tool";
import { paths } from "../store/paths";
import { ERRAND_OWNER as UID, errandOf, errandReceipt, errandSetup, poll, tool } from "../testing/errand-agent";
import { callRoute, fakeRequest, runScheduled, settle } from "../testing/fakes";
import { errandDeliveryId } from "./records";
import { runErrand } from "./run";

const LINE = "The plumber comes Thursday at 9.";
type Browser = "play" | "drop" | "lost";

describe("property: said once (brief 049, restated for review fix V2)", () => {
  it("200 runs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            polls: fc.integer({ min: 1, max: 4 }),
            waitMs: fc.oneof(fc.integer({ min: 0, max: 3_000 }), fc.integer({ min: ERRAND_OFFER_MS - 500, max: ERRAND_OFFER_MS + 4_000 }), fc.constant(ERRAND_RESULT_TTL_MS)),
            runners: fc.integer({ min: 0, max: 2 }),
            browser: fc.constantFrom<Browser>("play", "drop", "lost"),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (waves) => {
          const x = await errandSetup([{ call: "search_mail" }, { outcome: "answered", lines: [{ text: LINE, refs: ["r1"] }] }]);
          await callRoute(x.rig, toolRoute, tool(x));
          await runScheduled(x.rig);
          const id = x.errandId;
          const ctx = { uid: UID, deps: x.rig.deps, schedule: x.rig.sched.schedule };
          const readyAt = msFromTs((await errandOf(x))!.readyAt!);
          const quietFrom = x.rig.clock.read().opsClock.now;
          const offers: { at: number; expiresAt: number; noteId: string }[] = [];
          let receipted = false;
          let played = 0;
          for (const w of waves) {
            x.rig.clock.advance(w.waitMs);
            const at = x.rig.clock.read().opsClock.now;
            const outstanding = offers.length > 0 && offers[offers.length - 1]!.expiresAt > at;
            const quiet = at - quietFrom >= ERRAND_SILENCE_MS;
            const work = Promise.all([
              ...Array.from({ length: w.polls }, () => runRoute(stateRoute, fakeRequest({ body: poll(x) }), x.rig.deps, x.rig.sched.schedule)),
              ...Array.from({ length: w.runners }, () => runErrand(ctx, id)),
            ]);
            const { value } = await settle(work, x.rig.clock, x.rig.timers);
            const made = (value.slice(0, w.polls) as { status: number; body: any }[]).filter((r) => r.status === 200 && r.body.proactive?.whisper.momentId === id);
            // One wave of concurrent polls makes at most one offer.
            expect(made.length).toBeLessThanOrEqual(1);
            const offer = made[0];
            if (offer !== undefined) {
              expect(offer.body.proactive.whisper.text).toContain(LINE);
              // 1, 2 and 3.
              if (offers.length > 0) expect(at).toBeGreaterThanOrEqual(offers[offers.length - 1]!.expiresAt);
              expect(receipted).toBe(false);
              expect(at).toBeLessThan(readyAt + ERRAND_RESULT_TTL_MS);
              offers.push({ at, expiresAt: msFromTs(offer.body.proactive.permit.expiresAt), noteId: offer.body.proactive.whisper.noteId });
              if (w.browser !== "drop") played++;
              if (w.browser === "play") {
                const rc = await callRoute(x.rig, receiptRoute, errandReceipt(offer.body.proactive));
                expect(rc.body.accepted).toBe(true);
                receipted = true;
              }
            } else if (quiet && !outstanding && !receipted && at < readyAt + ERRAND_RESULT_TTL_MS) {
              // 5: nothing stood in the way, so an offer should have been made.
              expect.fail(`no offer at ${at - readyAt} ms after ready with nothing out`);
            }
            await runScheduled(x.rig);
          }
          // 4: one decision row per offer, none beyond.
          for (let k = 1; k <= offers.length + 1; k++) {
            const row = await x.rig.store.get<Ledger>(UID, paths.ledger(UID, errandDeliveryId(x.rig.deps.hasher, id, k)));
            expect(row !== null).toBe(k <= offers.length);
          }
          expect(new Set(offers.map((o) => o.noteId)).size).toBe(offers.length);
          if (receipted) expect((await errandOf(x))?.status).toBe("delivered");
          // 6: with no receipt lost, at most one play.
          if (!waves.some((w) => w.browser === "lost")) expect(played).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  }, 600_000);
});
