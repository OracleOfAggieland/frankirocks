// Brief 049 part A, review fix V8: property "Gated at the claim". Whatever changes between the poll's read of the
// Session and the claim that offers a found line (the audience goes to company, the call moves to a new generation,
// the Session closes, a forget bumps the epoch, a barrier goes up, the policy moves, a crisis is marked), and at
// whichever of the poll's errand store calls it lands before (the claim's transaction is the last of them), no line is
// offered on the poll's stale view:
//   - company: the third party's line is never spoken;
//   - any other change: nothing is offered, and no decision row exists for the attempt;
//   - no change: the line is offered (so the property is not passing vacuously).
// Seed and counterexample recorded in brief 049's report.
import { type CoreEpoch, ERRAND_SILENCE_MS, type ID, type Ledger, type Session, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toolRoute } from "../routes/tool";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import { ERRAND_OWNER as UID, errandSetup, tool } from "../testing/errand-agent";
import { callRoute, patchRecord, runScheduled } from "../testing/fakes";
import { errandsOnState } from "./deliver";
import { errandDeliveryId } from "./records";

const LINE = "The plumber comes Thursday at 9.";
type Change = "none" | "company" | "generation" | "closed" | "epoch" | "barrier" | "policy" | "crisis";
const CHANGES: Change[] = ["none", "company", "generation", "closed", "epoch", "barrier", "policy", "crisis"];

async function apply(store: StorePort, sessionId: string, change: Change, opsNow: number): Promise<void> {
  const sp = paths.session(UID, sessionId);
  const ep = paths.core(UID, "epoch");
  const s = (await store.get<Session>(UID, sp))!.data;
  const e = (await store.get<CoreEpoch>(UID, ep))!.data;
  switch (change) {
    case "none":
      return;
    case "company":
      return patchRecord<Session>(store, UID, sp, { audience: "company" });
    case "generation":
      return patchRecord<Session>(store, UID, sp, { generation: s.generation + 1 });
    case "closed":
      return patchRecord<Session>(store, UID, sp, { status: "closed" });
    case "crisis":
      return patchRecord<Session>(store, UID, sp, { modifiers: { ...s.modifiers, crisis: tsFromMs(opsNow) } as never });
    case "epoch":
      return patchRecord<CoreEpoch>(store, UID, ep, { epoch: e.epoch + 1 });
    case "policy":
      return patchRecord<CoreEpoch>(store, UID, ep, { policyRev: e.policyRev + 1 });
    case "barrier":
      return patchRecord<CoreEpoch>(store, UID, ep, { barrier: { opId: testId("forget-op") as ID, phase: "fence", startedAt: tsFromMs(opsNow), deadline: tsFromMs(opsNow + 60_000), queuedOps: [] } });
  }
}

describe("property: gated at the claim (review fix V8)", () => {
  it("120 runs", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...CHANGES), fc.integer({ min: 0, max: 4 }), async (change, atTx) => {
        const x = await errandSetup([{ call: "search_mail" }, { outcome: "answered", lines: [{ text: LINE, refs: ["r1"] }] }]);
        await callRoute(x.rig, toolRoute, tool(x));
        await runScheduled(x.rig);
        x.rig.clock.advance(ERRAND_SILENCE_MS + 100);
        const real = x.rig.store;
        const snapshot = (await real.get<Session>(UID, paths.session(UID, x.sessionId)))!.data;
        const opsNow = x.rig.clock.read().opsClock.now;
        // The change lands before the poll's `atTx`-th errand store call (0: before any of them). Past the last call
        // (the claim) it never lands, and the line must be offered as with no change.
        let n = 0;
        let applied = false;
        const store = new Proxy(real, {
          get(target, prop, recv) {
            const f = Reflect.get(target, prop, recv);
            if (prop !== "transaction" && prop !== "get") return f;
            return async (...args: unknown[]) => {
              if (!applied && n++ >= atTx) {
                applied = true;
                await apply(real, x.sessionId, change, opsNow);
              }
              return (f as (...a: unknown[]) => unknown).apply(target, args);
            };
          },
        }) as StorePort;
        const stamp = { sessionId: x.stamp.sessionId, epoch: x.stamp.epoch, policyRev: x.stamp.policyRev, bundleRev: x.stamp.bundleRev, rulesRev: x.stamp.rulesRev, generation: x.stamp.generation };
        const ctx = { uid: UID, deps: { ...x.rig.deps, store }, schedule: x.rig.sched.schedule };
        const out = await errandsOnState(ctx, { sessionId: x.sessionId as ID, session: snapshot, stamp, deck: { head: { text: "head" }, turns: [] } as never, mayOffer: true });
        const text = out.proactive?.whisper.text ?? "";
        const row = await real.get<Ledger>(UID, paths.ledger(UID, errandDeliveryId(x.rig.deps.hasher, x.errandId, 1)));
        if (change === "none" || !applied) {
          expect(text).toContain(LINE);
          return;
        }
        if (change === "company") {
          expect(text).not.toContain(LINE);
          return;
        }
        expect(out.proactive).toBeNull();
        expect(row).toBeNull();
      }),
      { numRuns: 120 },
    );
  }, 600_000);
});
