// Feature: voice-writes (brief 012 wave C, task C1), Property 6, worker half: a past fact never demotes the present
// (design section 7, 6.6, G35). A turn says "My name is X." and a later turn says "My name is Y."; the later turn's
// Extract_Job runs first, then the earlier one's. The current row (Y) keeps its status and `validTo`, and X is
// written `history`, never active.
import type { Memory } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { memoriesOf } from "../testing/arb-corrections";
import { type CommittedTurn, commitUserTurnForTest, extractOutput, factItem } from "../testing/extract-fixtures";
import { settle, testRig } from "../testing/fakes";
import { runExtractJob } from "./extract";

const UID = "owner-1";
/** Both clocks move: the next turn is said, and asserted, later. */
const tick = (rig: ReturnType<typeof testRig>, ms: number) => {
  rig.clock.advance(ms);
  rig.clock.setWorld(rig.clock.read().worldClock.now + ms);
};
const NAMES = ["Alec", "Alex", "Al", "Alexa"] as const;
const span = (t: CommittedTurn, start: number, end: number) => ({ eid: t.eid, fieldPath: "text" as const, start, end, quote: t.text.slice(start, end) });
const nameOut = (t: CommittedTurn, name: string, act: string) => {
  const at = t.text.indexOf(name);
  return ok(completed(JSON.stringify(extractOutput([{ ...factItem(act, "new", name, [span(t, at, at + name.length)]), predicate: "identity.name", args: {} }]))));
};

describe("Property 6 (worker): a past fact never demotes the present", () => {
  it("an earlier turn's name, committed later, is history and the current name stays", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...NAMES), fc.constantFrom(...NAMES), fc.integer({ min: 1, max: 600 }), fc.constantFrom("statement", "correction"), async (x, y, gapMin, act) => {
        fc.pre(x !== y);
        const rig = testRig();
        const run = (t: CommittedTurn) => settle(runExtractJob(UID, t.jobId, rig.deps), rig.clock, rig.timers);
        const a = await commitUserTurnForTest(rig.store, UID, testId("ta"), `My name is ${x}.`, rig.clock, rig.deps.hasher);
        tick(rig, gapMin * 60_000);
        const b = await commitUserTurnForTest(rig.store, UID, testId("tb"), `My name is ${y}.`, rig.clock, rig.deps.hasher);
        rig.openai.script("responses.create", nameOut(b, y, "statement"));
        await run(b);
        const current = [...(await memoriesOf(rig.store)).entries()].find(([, m]) => m.value.kind === "text" && m.value.text === y);
        expect(current, "the later name was written").toBeDefined();
        rig.openai.script("responses.create", nameOut(a, x, act));
        await run(a);
        const after = await memoriesOf(rig.store);
        const what = `"${x}" at t, "${y}" at t+${gapMin}m, act ${act}`;
        const now = after.get(current![0])!;
        expect([now.status, now.validTo], `${what}: the current row moved`).toEqual([current![1].status, current![1].validTo]);
        for (const m of after.values() as Iterable<Memory>) {
          if (m.value.kind === "text" && m.value.text === x) expect(m.status, `${what}: the earlier name is ${m.status}`).toBe("history");
        }
      }),
      { numRuns: 1000 },
    );
  });
});
