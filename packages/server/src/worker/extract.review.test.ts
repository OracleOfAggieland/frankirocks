// Brief 032 H1: extraction's `handled` skip matches the subject exactly (reverses W-175), so an anonymous key, such as
// the one an older route wrote for every code a denial named, never covers the owner's own affirmed item.
import type { CoreRules } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { type CommittedTurn, commitUserTurnForTest, extractOutput, factItem } from "../testing/extract-fixtures";
import { patchRecord, settle, testRig } from "../testing/fakes";
import { runExtractJob } from "./extract";

const UID = "owner-1";
const span = (turn: CommittedTurn, start: number, end: number) => ({ eid: turn.eid, fieldPath: "text" as const, start, end, quote: turn.text.slice(start, end) });
const allergy = (turn: CommittedTurn, code: string, phrase: string, bool = true, subject = "self") => {
  const at = turn.text.indexOf(phrase);
  return { ...factItem("statement", "new", "", [span(turn, at, at + phrase.length)]), subject, kind: "rule", predicate: "allergy", value: { kind: "boolean", bool }, args: { allergenCode: code } };
};
type Entry = CoreRules["handled"][number]["entries"][number];

async function run(text: string, entries: Entry[], items: (turn: CommittedTurn) => unknown[]) {
  const rig = testRig();
  const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), text, rig.clock, rig.deps.hasher);
  await patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), { handled: [{ eid: turn.eid, turnId: testId("t1"), entries }] });
  rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput(items(turn))))));
  const r = await settle(runExtractJob(UID, turn.jobId, rig.deps), rig.clock, rig.timers).then((x) => x.value);
  expect(r).toBe("complete");
  return (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
}
const installs = (r: CoreRules) => r.proposals.flatMap((p) => p.install.map((x) => `${x.anonymous ? "anyone" : x.subjectId}:${x.code}`));

describe("brief 032 H1: extraction's skip", () => {
  it("an anonymous key never covers the owner's own item (the reviewer's input)", async () => {
    const text = "I can't eat peanuts, I'm allergic.";
    const r = await run(text, [{ route: "hardRule", outcome: "denialRecorded", keys: [], refs: [], ruleKeys: [{ subjectId: null, code: "peanut" }] }], (t) => [allergy(t, "peanut", "peanuts")]);
    expect(installs(r)).toEqual(["self:peanut"]);
  });

  it("a slot key covers only its own subject", async () => {
    const text = "I'm allergic to peanuts.";
    const covered = await run(text, [{ route: "hardRule", outcome: "pendingWritten", keys: [], refs: [], ruleKeys: [{ subjectId: "self", code: "peanut" }] }], (t) => [allergy(t, "peanut", "peanuts")]);
    expect(installs(covered)).toEqual([]);
  });

  it("an anonymous slot key covers an anonymous item only", async () => {
    const text = "One of the guests is allergic to peanuts.";
    const slot: Entry = { route: "hardRule", outcome: "pendingWritten", keys: [], refs: [], ruleKeys: [{ subjectId: null, code: "peanut" }] };
    expect(installs(await run(text, [slot], (t) => [allergy(t, "peanut", "peanuts", true, "m1")]))).toEqual([]);
    expect(installs(await run(text, [slot], (t) => [allergy(t, "peanut", "peanuts", true, "self")]))).toEqual(["self:peanut"]);
  });
});
