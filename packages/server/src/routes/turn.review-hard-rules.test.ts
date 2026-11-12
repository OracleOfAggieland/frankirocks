// Brief 032: the review of the hard-rule route, on `/api/turn` with Fake_FastSlots.
import type { CoreRules } from "@franki/core";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, settle, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { turnRoute } from "./turn";

const UID = "owner-1";

async function setup() {
  const rig = testRig();
  rig.openai.always("responses.create", ok(completed("All right.")));
  const s = await openTestSession(rig);
  return { rig, stamp: s.stamp };
}
const rulesOf = async (rig: TestRig) => (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
const post = (rig: TestRig, body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);
const decide = (rig: TestRig) => rig.openai.script("decisions.create", ok(decisionAnswer({ hardRule: 0.9 })));
const SELF = { entityId: null, mention: null, isSelf: true };

describe("brief 032 H1 on the route", () => {
  it("\"I can't eat peanuts, I'm allergic.\" marked denied: a peanut filter, and no key without its subject", async () => {
    const { rig, stamp } = await setup();
    const text = "I can't eat peanuts, I'm allergic.";
    const quote = "I can't eat peanuts, I'm allergic";
    decide(rig);
    rig.fastSlots.script((input) => ({
      kind: "valid",
      out: { items: [{ kind: "allergy", subject: SELF, item: "peanuts", severity: "allergy", polarity: "denied", act: "direct", span: { eid: input.turn.eid, fieldPath: "text", start: 0, end: quote.length, quote } }], need: "none" },
      ms: 50,
    }));
    await post(rig, typedTurn(stamp, 1, text));
    const r = await rulesOf(rig);
    expect(r.allergies.some((x) => x.code === "peanut" && (x.anonymous || x.subjectId === "self"))).toBe(true);
    // One entry: the slot coverage filed. The denial's code is no key of its own (it would cover the owner's item).
    expect(r.handled.at(-1)!.entries).toEqual([{ route: "hardRule", outcome: "pendingWritten", keys: [], refs: [], ruleKeys: [{ subjectId: null, code: "peanut" }] }]);
  });
});
