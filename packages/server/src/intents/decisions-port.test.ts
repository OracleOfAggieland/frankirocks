import { DECISIONS_DEADLINE_MS, buildTurnIntents } from "@franki/core";
import { describe, expect, it } from "vitest";
import { fail, never, ok } from "../openai/fake";
import { TEST_ENV, settle, testRig } from "../testing/fakes";
import { decisionsModel, decisionsPort } from "./decisions-port";

const body = () => {
  const r = buildTurnIntents({ utterance: "hello", lastQuestion: null, doors: [] }, decisionsModel(TEST_ENV));
  if (!r.ok) throw new Error("not built");
  return r.body;
};

describe("Decisions_Port", () => {
  it("sends the body to decisions.create and returns the answer", async () => {
    const rig = testRig();
    rig.openai.script("decisions.create", ok({ answers: [] }));
    const port = decisionsPort(rig.deps);
    const { value } = await settle(port.decide(body(), DECISIONS_DEADLINE_MS), rig.clock, rig.timers);
    expect(value).toEqual({ ok: true, decision: { answers: [] }, ms: 0 });
    expect(rig.openai.requestsTo("decisions.create")[0]!.body).toMatchObject({ model: "test-bg-model", questions: expect.any(Array) });
  });

  it("a missed deadline is `deadline`, on the opsClock", async () => {
    const rig = testRig();
    rig.openai.script("decisions.create", never());
    const { value, elapsedMs } = await settle(decisionsPort(rig.deps).decide(body(), DECISIONS_DEADLINE_MS), rig.clock, rig.timers);
    expect(value).toEqual({ ok: false, why: "deadline", ms: DECISIONS_DEADLINE_MS });
    expect(elapsedMs).toBe(DECISIONS_DEADLINE_MS);
  });

  it("a thrown error is `transport`", async () => {
    const rig = testRig();
    rig.openai.script("decisions.create", fail(new Error("boom")));
    const { value } = await settle(decisionsPort(rig.deps).decide(body(), DECISIONS_DEADLINE_MS), rig.clock, rig.timers);
    expect(value).toMatchObject({ ok: false, why: "transport" });
  });

  it("the model comes from FRANKI_BG_MODEL", () => {
    expect(decisionsModel({ ...TEST_ENV, FRANKI_BG_MODEL: "x-model" })).toBe("x-model");
    expect(() => decisionsModel({})).toThrow(/FRANKI_BG_MODEL/);
  });
});
