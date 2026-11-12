// Brief 018 task B8: the allergy backstop in the extraction worker (brief 012 section 5, G18, G39).
import { type CoreRules, buildSlice, backstopProposal, rootKey } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { applyProposals } from "../onturn/proposals";
import { paths } from "../store/paths";
import { type CommittedTurn, commitUserTurnForTest, extractOutput, factItem } from "../testing/extract-fixtures";
import { patchRecord, settle, testRig } from "../testing/fakes";
import { runExtractJob } from "./extract";

const UID = "owner-1";
const span = (turn: CommittedTurn, start: number, end: number) => ({ eid: turn.eid, fieldPath: "text" as const, start, end, quote: turn.text.slice(start, end) });
const allergy = (turn: CommittedTurn, code: string, phrase: string, subject = "self") => {
  const at = turn.text.indexOf(phrase);
  return { ...factItem("statement", "new", "", [span(turn, at, at + phrase.length)]), subject, kind: "rule", predicate: "allergy", value: { kind: "boolean", bool: true }, args: { allergenCode: code } };
};

async function setup(text: string) {
  const rig = testRig();
  const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), text, rig.clock, rig.deps.hasher);
  const rules = async () => (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
  const run = () => settle(runExtractJob(UID, turn.jobId, rig.deps), rig.clock, rig.timers).then((r) => r.value);
  return { rig, turn, rules, run };
}

describe("the allergy backstop (B8)", () => {
  it("an allergy the route didn't handle becomes a pending proposal, without raising rulesRev", async () => {
    const { rig, turn, rules, run } = await setup("I'm allergic to shellfish. Oh, and cashews too.");
    const rev = (await rules()).rulesRev;
    rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([allergy(turn, "cashew", "cashews")])))));
    expect(await run()).toBe("complete");
    const r = await rules();
    expect(r.rulesRev).toBe(rev);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ origin: "backstop", eid: turn.eid, install: [{ subjectId: "self", code: "cashew", state: "pending", proof: { quote: "cashews" } }] });
    // The next turn's application adds the slot and raises rulesRev.
    const applied = applyProposals(r);
    expect(applied.rules.allergies.map((x) => [x.subjectId, x.code, x.state])).toEqual([["self", "cashew", "pending"]]);
    expect(applied.rules.rulesRev).toBe(rev + 1);
    expect(applied.rules.proposals).toEqual([]);
  });

  it("an item whose (subject, code) the route handled is skipped, and no proposal is written", async () => {
    const { rig, turn, rules, run } = await setup("I'm allergic to shellfish.");
    await patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), {
      handled: [{ eid: turn.eid, turnId: testId("t1"), entries: [{ route: "hardRule", outcome: "ruleWritten", keys: [], refs: [], ruleKeys: [{ subjectId: "self", code: "shellfish" }] }] }],
    });
    rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([allergy(turn, "shellfish", "shellfish")])))));
    expect(await run()).toBe("complete");
    expect((await rules()).proposals).toEqual([]);
  });

  it("an item not in ruleKeys still goes to the backstop", async () => {
    const { rig, turn, rules, run } = await setup("I'm allergic to shellfish and sesame.");
    await patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), {
      handled: [{ eid: turn.eid, turnId: testId("t1"), entries: [{ route: "hardRule", outcome: "ruleWritten", keys: [], refs: [], ruleKeys: [{ subjectId: "self", code: "shellfish" }] }] }],
    });
    rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([allergy(turn, "shellfish", "shellfish"), allergy(turn, "sesame", "sesame")])))));
    expect(await run()).toBe("complete");
    expect((await rules()).proposals[0]!.install.map((x) => x.code)).toEqual(["sesame"]);
  });

  it("T and M text proposes nothing", () => {
    const H = testRig().deps.hasher;
    const text = "I'm allergic to shellfish.";
    const eid = "e".repeat(43);
    for (const cls of ["T", "M"] as const) {
      const slices = [buildSlice({ eid, fieldPath: "text", fieldText: text, start: 0, end: text.length, class: cls, sens: "S0" }, H)];
      const ev = { eid, rev: 1, text, slices, rootKeys: slices.map((s) => rootKey(s, H)), assertedAt: "2026-11-10T18:00:00.000Z" };
      const items = [{ act: "statement", subject: "self", allergenCode: "shellfish", spans: [{ eid, fieldPath: "text" as const, start: 16, end: 25, quote: "shellfish" }] }];
      expect(backstopProposal(ev, items, [], null, H), cls).toBeNull();
    }
  });
});
