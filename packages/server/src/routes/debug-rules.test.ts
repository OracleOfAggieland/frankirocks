// Brief 018 task B11: the Debug_Panel's rules section on GET /api/debug/memory.
import { type CoreRules, DebugPage, type Session, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { template } from "../testing/arb-rule-turns";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { debugMemoryRoute } from "./debug-memory";
import { turnRoute } from "./turn";

const UID = "owner-1";
const get = (rig: TestRig) => callRoute(rig, debugMemoryRoute, undefined, { method: "GET", url: "http://localhost:3000/api/debug/memory?section=rules", origin: null });
const rulesOf = async (rig: TestRig) => (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;

async function withShellfishRule() {
  const rig = testRig();
  rig.openai.always("responses.create", ok(completed("All right.")));
  const s = await openTestSession(rig);
  await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  const t = template("self", "shellfish", "peanuts");
  rig.openai.script("decisions.create", ok(decisionAnswer({ hardRule: 0.9 })));
  rig.fastSlots.script((input) => ({ kind: "valid", out: { items: t.items(input.turn.eid), need: "none" }, ms: 50 }));
  await settle(callRoute(rig, turnRoute, asrTurn(s.stamp, 1, t.text, [{ itemId: "item_1", commitSeq: 1 }])), rig.clock, rig.timers);
  return rig;
}

describe("GET /api/debug/memory?section=rules (B11)", () => {
  it("lists the rules with their proof checked against the Evidence, the proposals and noneConfirmed", async () => {
    const rig = await withShellfishRule();
    const rules = await rulesOf(rig);
    expect(rules.allergies).toHaveLength(1);
    const rule = rules.allergies[0]!;
    const proposed = { ...rule, id: testId("proposed-rule"), code: "peanut", state: "pending" as const, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
    await patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), {
      noneConfirmed: ["self"],
      proposals: [{ id: testId("prop"), origin: "repair", turnId: null, eid: rule.proof!.eid, install: [proposed] }],
    });
    const res = await get(rig);
    expect(res.status).toBe(200);
    expect(validate(DebugPage, res.body).ok).toBe(true);
    const item = res.body.items[0];
    expect(item).toMatchObject({ kind: "rules", id: "rules", record: { noneConfirmed: ["self"], rulesRev: rules.rulesRev } });
    expect(item.record.allergies[0]).toMatchObject({ subjectId: "self", code: "shellfish", state: "active", proof: { quote: "I'm allergic to shellfish" } });
    expect(item.proofs).toEqual([
      { ruleId: rule.id, from: "rule", state: "verified" },
      { ruleId: testId("proposed-rule"), from: "proposal", state: "none" },
    ]);
  });

  it("marks a proof whose quote or revision no longer matches its Evidence", async () => {
    const rig = await withShellfishRule();
    const rule = (await rulesOf(rig)).allergies[0]!;
    await patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), {
      allergies: [
        { ...rule, proof: { ...rule.proof!, quote: "I'm allergic to cashews" } },
        { ...rule, id: testId("rev"), code: "milk", proofRev: rule.proofRev! + 1 },
        { ...rule, id: testId("gone"), code: "egg", proof: { ...rule.proof!, eid: testId("no-such-evidence") } },
      ],
    });
    const res = await get(rig);
    expect(res.body.items[0].proofs.map((p: { state: string }) => p.state)).toEqual(["spanQuoteMismatch", "revMismatch", "missingEvidence"]);
  });
});
