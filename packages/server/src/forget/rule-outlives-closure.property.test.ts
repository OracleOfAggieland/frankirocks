// Feature: forget, part two (brief 047): a hard rule outlives closure and purge too (FP1's claim through `done`).
// For any forget run to `done`, every committed hard rule is still in `core/rules`, `active` or `pending`; an active
// rule's proof names a retained Evidence whose text at the span is the quote; and a pending one names no erased root.
import { type CoreRules, type Evidence, evidenceFieldText } from "@franki/core";
import { nrWorldArb } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { fakeCallClose } from "./close-port";
import { WORLD_UID, allDone, forgetMemory, stepAll, storeWorld } from "./testing/world";

describe("a hard rule outlives closure and purge (brief 047; FP1 through done)", () => {
  it("every committed rule is still in core/rules, and an active rule's proof still reads", async () => {
    await fc.assert(
      fc.asyncProperty(
        nrWorldArb.filter((w) => w.turns.some((t) => t.allergy)),
        async (w) => {
          const s = await storeWorld(w);
          const { store } = s.rig.deps;
          const closer = fakeCallClose(() => "closed");
          await forgetMemory(s, w.target, "rule-1");
          for (let step = 0; step < 200 && !(await allDone(store)); step++) await stepAll(s, closer);
          expect(await allDone(store), "the forget never finished").toBe(true);
          const rules = (await store.get<CoreRules>(WORLD_UID, paths.core(WORLD_UID, "rules")))!.data;
          for (const id of s.ruleIds) {
            const r = rules.allergies.find((a) => a.id === id);
            expect(r, `rule ${id} is gone`).toBeDefined();
            expect(["active", "pending"]).toContain(r!.state);
            if (r!.state === "active" && r!.proof !== null) {
              const e = (await store.get<Evidence>(WORLD_UID, paths.evidence(WORLD_UID, r!.proof.eid)))?.data;
              expect(e?.status, "the proof's Evidence is not retained").toBe("retained");
              expect((evidenceFieldText(e!, r!.proof.fieldPath) ?? "").slice(r!.proof.start, r!.proof.end)).toBe(r!.proof.quote);
            }
            if (r!.state === "pending") expect(r!.rootKeys).toEqual([]);
          }
        },
      ),
      { numRuns: 150 },
    );
  }, 600_000);
});
