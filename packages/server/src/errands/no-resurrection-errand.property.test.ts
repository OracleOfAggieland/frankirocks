// Brief 049 property "No Resurrection through an errand" (part A, ruling 14), the errand side: a forget at any point
// of an Errand's life (before its run, in the middle of a tool call, while its result waits, after it was said)
// leaves nothing of what it found: no later poll says it or shows it on a card, no runner writes it back, and the
// stored Errand keeps no line and no read. Both ways a forget reaches an Errand are drawn: the executor's drop, and the
// epoch move alone (an Errand the drop missed). Seed and counterexample recorded in brief 049's report.
import { ERRAND_SILENCE_MS, type CoreEpoch, type Errand, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { stateRoute } from "../routes/state";
import { toolRoute } from "../routes/tool";
import { paths } from "../store/paths";
import { ERRAND_OWNER as UID, type ErrandSetup, errandOf, errandSetup, poll, searchTool, tool } from "../testing/errand-agent";
import { type TestRig, callRoute, runScheduled } from "../testing/fakes";
import { dropErrandsInTx, errandsToDrop } from "./forget";

const LINE = "The plumber comes Thursday at 9.";
const SECRET = ["Thursday at 9", "Pat Plumber", "Your visit"];
type When = "beforeRun" | "midTool" | "ready" | "delivered";

/** What the forget does to errands: its epoch move and barrier, the executor's drop (unless `dropMissed`), then the barrier comes down. */
async function forget(rig: TestRig, dropMissed: boolean): Promise<void> {
  const now = tsFromMs(rig.clock.read().opsClock.now);
  await rig.store.transaction(UID, async (tx) => {
    const e = (await tx.get<CoreEpoch>(paths.core(UID, "epoch")))!;
    tx.update(e.path, { ...e.data, epoch: e.data.epoch + 1, barrier: { opId: testId("forget-op"), phase: "close", startedAt: now, deadline: tsFromMs(rig.clock.read().opsClock.now + 60_000), queuedOps: [] }, updatedAt: now });
  });
  if (!dropMissed) {
    const ids = await errandsToDrop(rig.store, UID);
    await rig.store.transaction(UID, (tx) => dropErrandsInTx(tx, UID, ids, now).then(() => undefined));
  }
  await rig.store.transaction(UID, async (tx) => {
    const e = (await tx.get<CoreEpoch>(paths.core(UID, "epoch")))!;
    tx.update(e.path, { ...e.data, barrier: null, updatedAt: now });
  });
}

const leaks = (body: unknown) => SECRET.some((s) => JSON.stringify(body).includes(s));

describe("property: no resurrection through an errand (brief 049)", () => {
  it("200 runs", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<When>("beforeRun", "midTool", "ready", "delivered"), fc.boolean(), fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 1 }), async (when, dropMissed, polls, extraRunners) => {
        const x: ErrandSetup = await errandSetup([{ call: "search_mail" }, { outcome: "answered", lines: [{ text: LINE, refs: ["r1"] }] }]);
        let forgotten = false;
        if (when === "midTool") {
          const inner = searchTool(() => x.mail);
          x.rig.deps.errandAgents = [{ id: "test-mail", about: "mail", instructions: "Test agent.", tools: [{ ...inner, run: async (ctx, args) => { const out = await inner.run(ctx, args); await forget(x.rig, dropMissed); forgotten = true; return out; } }], available: async () => "ready" }];
        }
        await callRoute(x.rig, toolRoute, tool(x));
        if (when === "beforeRun") {
          await forget(x.rig, dropMissed);
          forgotten = true;
        }
        await runScheduled(x.rig);
        if (when === "ready" || when === "delivered") {
          expect((await errandOf(x))?.status).toBe("ready");
          if (when === "delivered") {
            x.rig.clock.advance(ERRAND_SILENCE_MS + 1);
            const said = await callRoute(x.rig, stateRoute, poll(x));
            expect(said.body.proactive?.whisper.text).toContain(LINE);
          }
          await forget(x.rig, dropMissed);
          forgotten = true;
        }
        expect(forgotten).toBe(true);
        // Whatever ran on keeps running; extra runners start; quiet polls come.
        const ctx = { uid: UID, deps: x.rig.deps, schedule: x.rig.sched.schedule };
        const { runErrand } = await import("./run");
        for (let i = 0; i < extraRunners; i++) await runErrand(ctx, x.errandId);
        for (let i = 0; i < polls; i++) {
          x.rig.clock.advance(ERRAND_SILENCE_MS + 1);
          const st = await callRoute(x.rig, stateRoute, poll(x));
          expect(st.status).toBe(200);
          expect(leaks(st.body)).toBe(false);
          await runScheduled(x.rig);
        }
        const e = (await x.rig.store.get<Errand>(UID, paths.errand(UID, x.errandId)))?.data ?? null;
        expect(e?.status).toBe("dropped");
        expect(e?.lines).toEqual([]);
        expect(e?.reads).toEqual([]);
      }),
      { numRuns: 200 },
    );
  }, 600_000);
});
