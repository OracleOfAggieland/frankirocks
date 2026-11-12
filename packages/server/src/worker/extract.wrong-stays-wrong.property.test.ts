// Brief 043, new property 6: wrong stays wrong in any order. The owner says "My name is A.", then "No, my name is B,
// not A.", and maybe later "These days my name is C."; the extraction jobs run in any order in which A's own job runs
// before the correction's (so A is saved when the correction is read). A value the owner called wrong (A) ends
// `wrong`, never `history` or `active`. The order where the correction's job runs before A was ever saved is left out:
// code then has no row of A to mark (question W-215 in the brief's Outcome).
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
const NAMES = ["Alec", "Alex", "Al", "Alexa", "Sasha"] as const;
const tick = (rig: ReturnType<typeof testRig>, ms: number) => {
  rig.clock.advance(ms);
  rig.clock.setWorld(rig.clock.read().worldClock.now + ms);
};
const nameOut = (t: CommittedTurn, name: string, act: string) => {
  const at = t.text.indexOf(name);
  const span = { eid: t.eid, fieldPath: "text" as const, start: at, end: at + name.length, quote: name };
  return ok(completed(JSON.stringify(extractOutput([{ ...factItem(act, "new", name, [span]), predicate: "identity.name", args: {} }]))));
};

describe("Property 6 (brief 043): wrong stays wrong in any order", () => {
  it("the refuted name ends wrong", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray([...NAMES], { minLength: 3, maxLength: 3 }),
        fc.boolean(),
        fc.array(fc.integer({ min: 1, max: 600 }), { minLength: 2, maxLength: 2 }),
        fc.nat(5),
        fc.constantFrom("These days my name is {C}.", "My name is {C}."),
        async ([a, b, c], later, gaps, order, laterWords) => {
          const rig = testRig();
          const run = (t: CommittedTurn, name: string, act: string) => {
            rig.openai.script("responses.create", nameOut(t, name, act));
            return settle(runExtractJob(UID, t.jobId, rig.deps), rig.clock, rig.timers);
          };
          const t1 = await commitUserTurnForTest(rig.store, UID, testId("t1"), `My name is ${a}.`, rig.clock, rig.deps.hasher);
          tick(rig, gaps[0]! * 60_000);
          const t2 = await commitUserTurnForTest(rig.store, UID, testId("t2"), `No, my name is ${b}, not ${a}.`, rig.clock, rig.deps.hasher);
          tick(rig, gaps[1]! * 60_000);
          const t3 = later ? await commitUserTurnForTest(rig.store, UID, testId("t3"), laterWords.replace("{C}", c!), rig.clock, rig.deps.hasher) : null;
          const jobs: [CommittedTurn, string, string][] = [[t1, a!, "statement"], [t2, b!, "correction"], ...(t3 === null ? [] : [[t3, c!, "statement"] as [CommittedTurn, string, string]])];
          // Orders with t1's job before t2's: t3 first, between, or last.
          const orders = t3 === null ? [[0, 1]] : [[0, 1, 2], [0, 2, 1], [2, 0, 1]];
          const pick = orders[order % orders.length]!;
          for (const i of pick) await run(...jobs[i]!);
          const what = `A=${a} B=${b}${t3 === null ? "" : ` C=${c}`} order ${pick.join(",")}`;
          for (const m of (await memoriesOf(rig.store)).values() as Iterable<Memory>) {
            if (m.predicate === "identity.name" && m.value.kind === "text" && m.value.text === a) expect(m.status, `${what}: ${a} is ${m.status}`).toBe("wrong");
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});
