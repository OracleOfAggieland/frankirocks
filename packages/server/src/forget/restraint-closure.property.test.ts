// Feature: forget, part two (brief 047): restraint survives closure (FP3's claim for every row closure withdraws).
// For any forget run to `done`, every effect premised on a Memory that withdrew (and was not the target) is
// retracted, and each exclude, quiet or care hold among them survives as an active, content-free `withdrawnHold` on the
// same target and scope, of the same hold kind, at no lower sensitivity. Effects premised on Memories that did not
// withdraw are untouched.
import { type Effect, HOLD_KINDS, type ID, type Sens } from "@franki/core";
import { nrWorldArb } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { fakeCallClose } from "./close-port";
import { WORLD_UID, allDone, forgetMemory, oracleDerivatives, stepAll, storeWorld } from "./testing/world";

const RANK: Record<Sens, number> = { S0: 0, S1: 1, S2: 2 };
const canon = (v: unknown) => JSON.stringify(v);

describe("restraint survives closure (brief 047; FP3 for closure)", () => {
  it("every hold on a withdrawn Memory lives on as a content-free withdrawnHold", async () => {
    await fc.assert(
      fc.asyncProperty(nrWorldArb, async (w) => {
        const s = await storeWorld(w);
        const { store, hasher } = s.rig.deps;
        const closer = fakeCallClose(() => "closed");
        await forgetMemory(s, w.target, "restraint-1");
        for (let step = 0; step < 200 && !(await allDone(store)); step++) await stepAll(s, closer);
        expect(await allDone(store), "the forget never finished").toBe(true);
        const withdrawn = new Set([...oracleDerivatives(w, w.target)].filter((i) => i !== w.target).map((i) => s.memoryIds[i]!));
        const rows = await store.query<Effect>(WORLD_UID, { collection: paths.collection(WORLD_UID, "effects"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
        const holds = rows.filter((r) => r.data.kind === "withdrawnHold" && r.data.state === "active").map((r) => r.data);
        for (let k = 0; k < w.effects.length; k++) {
          const id: ID = hasher.id(["nr-effect", k]);
          const e = rows.find((r) => r.id === id)!.data;
          const premise = e.premiseIds[0]!.id;
          if (premise === s.memoryIds[w.target]) continue; // A target-premise effect retracts at install.
          if (!withdrawn.has(premise)) {
            expect(e.state, `effect ${k} on a survivor changed`).toBe("active");
            continue;
          }
          expect(e.state, `effect ${k} premised on a withdrawn Memory is still active`).toBe("retracted");
          if (!(HOLD_KINDS as readonly string[]).includes(e.kind)) continue;
          const kept = holds.find((h) => h.holdKind === e.kind && canon(h.target) === canon(e.target) && canon(h.scope) === canon(e.scope));
          expect(kept, `the ${e.kind} of effect ${k} lost its restraint`).toBeDefined();
          expect(RANK[kept!.minSens] >= RANK[e.minSens], `the ${e.kind} of effect ${k} fell in sensitivity`).toBe(true);
          expect(kept!.contentFree).toBe(true);
          expect(kept!.premiseIds).toEqual([]);
        }
      }),
      { numRuns: 150 },
    );
  }, 600_000);
});
