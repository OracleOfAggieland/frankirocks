// Brief 025 task C5: extraction honours what the on-turn route handled, in transcript order (design section 5, G35).
// P7, P5 (worker) and P6 (worker) are the properties; these are the single cases behind them.
import type { Evidence, Memory } from "@franki/core";
import { sampleMemory, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { memoriesOf } from "../testing/arb-corrections";
import { type CommittedTurn, commitUserTurnForTest, extractOutput, factItem } from "../testing/extract-fixtures";
import { settle, testRig } from "../testing/fakes";
import { pickOpen, runExtractJob } from "./extract";

const UID = "owner-1";
const say = (text: string) => ({ text, entityRefs: [], timeFields: [] });
const tick = (rig: ReturnType<typeof testRig>, ms: number) => {
  rig.clock.advance(ms);
  rig.clock.setWorld(rig.clock.read().worldClock.now + ms);
};
const nameOut = (t: CommittedTurn, name: string, act: string) => {
  const at = t.text.indexOf(name);
  const span = { eid: t.eid, fieldPath: "text" as const, start: at, end: at + name.length, quote: name };
  return ok(completed(JSON.stringify(extractOutput([{ ...factItem(act, "new", name, [span]), predicate: "identity.name", args: {} }]))));
};
const names = async (rig: ReturnType<typeof testRig>) => [...(await memoriesOf(rig.store)).values()].filter((m) => m.predicate === "identity.name").map((m) => [m.value.kind === "text" ? m.value.text : "", m.status]);

describe("extraction honours handled, in transcript order (task C5)", () => {
  it("pickOpen never offers a Memory the route handled", () => {
    const row = { id: testId("rel"), memory: sampleMemory({ sayAs: say("Maya is the owner's sister."), entityIds: [] }) };
    expect(pickOpen([row], ["Maya is my sister."]).list.map((o) => o.id)).toEqual([testId("rel")]);
    expect(pickOpen([row], ["Maya is my sister."], undefined, new Set([testId("rel")])).list).toEqual([]);
  });

  it("an earlier name whose job commits after a later one is history, and the later name stays", async () => {
    const rig = testRig();
    const run = (t: CommittedTurn) => settle(runExtractJob(UID, t.jobId, rig.deps), rig.clock, rig.timers);
    const a = await commitUserTurnForTest(rig.store, UID, testId("ta"), "My name is Alec.", rig.clock, rig.deps.hasher);
    tick(rig, 60_000);
    const b = await commitUserTurnForTest(rig.store, UID, testId("tb"), "My name is Alex.", rig.clock, rig.deps.hasher);
    rig.openai.script("responses.create", nameOut(b, "Alex", "statement"));
    await run(b);
    rig.openai.script("responses.create", nameOut(a, "Alec", "statement"));
    await run(a);
    expect((await names(rig)).sort()).toEqual([["Alec", "history"], ["Alex", "active"]]);
  });

  it("a restatement said before the correction is skipped negated; one said after is written", async () => {
    const rig = testRig();
    const run = (t: CommittedTurn) => settle(runExtractJob(UID, t.jobId, rig.deps), rig.clock, rig.timers);
    const a = await commitUserTurnForTest(rig.store, UID, testId("ta"), "My name is Alec.", rig.clock, rig.deps.hasher);
    tick(rig, 60_000);
    const b = await commitUserTurnForTest(rig.store, UID, testId("tb"), "My name is Alec.", rig.clock, rig.deps.hasher);
    tick(rig, 60_000);
    const c = await commitUserTurnForTest(rig.store, UID, testId("tc"), "No, my name is Alex, not Alec.", rig.clock, rig.deps.hasher);
    for (const [t, n, act] of [[a, "Alec", "statement"], [c, "Alex", "correction"], [b, "Alec", "statement"]] as const) {
      rig.openai.script("responses.create", nameOut(t, n, act));
      await run(t);
    }
    expect((await names(rig)).sort()).toEqual([["Alec", "wrong"], ["Alex", "active"]]);
    tick(rig, 60_000);
    const d = await commitUserTurnForTest(rig.store, UID, testId("td"), "My name is Alec.", rig.clock, rig.deps.hasher);
    rig.openai.script("responses.create", nameOut(d, "Alec", "statement"));
    await run(d);
    const after = [...(await memoriesOf(rig.store)).values()] as Memory[];
    const back = after.find((m) => m.status === "active" && m.value.kind === "text" && m.value.text === "Alec")!;
    expect(back.rootSlices[0]!.eid).toBe(d.eid);
    expect(back.assertedAt).toBe((await rig.store.get<Evidence>(UID, paths.evidence(UID, d.eid)))!.data.assertedAt);
  });
});
