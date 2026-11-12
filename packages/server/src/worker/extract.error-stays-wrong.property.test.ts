// Feature: voice-writes (brief 012 wave C, task C1), Property 5, worker half: an error never becomes history (design
// section 7, 6.5, G35; spec §4). The owner says "My name is V." twice, the first turn's job writes V, and then a
// correction ("No, my name is W, not V.") marks V `wrong`. The second "My name is V." turn, asserted before the
// correction, has its Extract_Job commit after it. Afterwards no row with value V is active, scheduled or history
// unless all its root Evidence was asserted after the correction, the corrected row stays `wrong`, and W is still
// active unless a later turn changed it.
import type { Evidence, Memory } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
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

describe("Property 5 (worker): an error never becomes history", () => {
  it("a restatement asserted before the correction never brings the wrong value back", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...NAMES), fc.constantFrom(...NAMES), fc.constantFrom("statement", "correction"), fc.boolean(), async (v, w, act, laterRestates) => {
        fc.pre(v !== w);
        const rig = testRig();
        const run = (t: CommittedTurn) => settle(runExtractJob(UID, t.jobId, rig.deps), rig.clock, rig.timers);
        const a = await commitUserTurnForTest(rig.store, UID, testId("ta"), `My name is ${v}.`, rig.clock, rig.deps.hasher);
        tick(rig, 60_000);
        const b = await commitUserTurnForTest(rig.store, UID, testId("tb"), `My name is ${v}.`, rig.clock, rig.deps.hasher);
        tick(rig, 60_000);
        const c = await commitUserTurnForTest(rig.store, UID, testId("tc"), `No, my name is ${w}, not ${v}.`, rig.clock, rig.deps.hasher);
        rig.openai.script("responses.create", nameOut(a, v, "statement"));
        await run(a);
        rig.openai.script("responses.create", nameOut(c, w, "correction"));
        await run(c);
        const corrected = await memoriesOf(rig.store);
        const wrongIds = [...corrected.entries()].filter(([, m]) => m.status === "wrong").map(([id]) => id);
        const t = (await rig.store.get<Evidence>(UID, paths.evidence(UID, c.eid)))!.data.assertedAt;
        rig.openai.script("responses.create", nameOut(b, v, act));
        await run(b);
        if (laterRestates) {
          tick(rig, 60_000);
          const d = await commitUserTurnForTest(rig.store, UID, testId("td"), `My name is ${v}.`, rig.clock, rig.deps.hasher);
          rig.openai.script("responses.create", nameOut(d, v, "statement"));
          await run(d);
        }
        const after = await memoriesOf(rig.store);
        const what = `"${v}" corrected to "${w}", restated before (${act})${laterRestates ? " and after" : ""}`;
        expect(wrongIds.length, `${what}: the correction marked nothing wrong`).toBeGreaterThan(0);
        for (const id of wrongIds) expect(after.get(id)!.status, `${what}: the corrected row`).toBe("wrong");
        for (const m of after.values() as Iterable<Memory>) {
          if (m.value.kind !== "text" || m.value.text !== v || m.status === "wrong") continue;
          const roots = await Promise.all(m.rootSlices.map(async (s) => (await rig.store.get<Evidence>(UID, paths.evidence(UID, s.eid)))!.data.assertedAt));
          expect(roots.every((r) => r > t), `${what}: ${v} came back ${m.status} from Evidence asserted ${roots.join(",")}`).toBe(true);
        }
        if (!laterRestates) expect([...after.values()].some((m) => m.status === "active" && m.value.kind === "text" && m.value.text === w), `${what}: ${w} is no longer active`).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});
