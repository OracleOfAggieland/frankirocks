import { describe, expect, it } from "vitest";
import { fail, never, ok } from "../openai/fake";
import { decisionAnswer } from "../testing/decisions";
import { settle, testRig } from "../testing/fakes";
import { decisionsPort } from "./decisions-port";
import { runSlowParse } from "./slow-parse";

function parser() {
  const rig = testRig();
  const deps = { decisions: decisionsPort(rig.deps), env: rig.deps.env, log: rig.deps.log };
  const run = (utterance: string) => settle(runSlowParse(deps, { turnId: "t1", utterance }), rig.clock, rig.timers).then((r) => r.value);
  return { rig, run };
}

describe("runSlowParse", () => {
  it("ordinary, and a hit with its chosen class", async () => {
    const { rig, run } = parser();
    rig.openai.script("decisions.create", ok(decisionAnswer()), ok(decisionAnswer({ forget: 0.9, food: 0.4 })));
    expect((await run("my dog loves the park")).parse).toEqual({ kind: "ordinary" });
    expect((await run("forget that")).parse).toEqual({ kind: "hit", chosen: "forget", candidates: ["forget", "food"], uncertain: false });
  });

  it("fails on a missed deadline, a transport error, a bad answer and an oversize turn", async () => {
    const { rig, run } = parser();
    rig.openai.script("decisions.create", never(), fail(new Error("x")), ok({ answers: [] }));
    expect((await run("hello")).parse).toEqual({ kind: "failed", why: "deadline" });
    expect((await run("hello")).parse).toEqual({ kind: "failed", why: "transport" });
    expect((await run("hello")).parse).toEqual({ kind: "failed", why: "invalid" });
    expect((await run("a".repeat(2_400))).parse).toEqual({ kind: "failed", why: "oversize" });
    expect(rig.openai.requestsTo("decisions.create")).toHaveLength(3);
  });

  it("an invalid answer says which check failed, logs it by question name only, and keeps the words out (review of the live run, item 4)", async () => {
    const { rig, run } = parser();
    const answer = decisionAnswer();
    answer.answers[2] = { type: "refusal", name: answer.answers[2]!.name } as never;
    rig.openai.script("decisions.create", ok(answer));
    const r = await run("my secret words");
    expect(r.parse).toEqual({ kind: "failed", why: "invalid" });
    expect(r.invalid).toEqual({ reason: "refusal", index: 2, name: answer.answers[2]!.name });
    const line = rig.logs.find((l) => l.event === "turn.parseInvalid");
    expect(line).toMatchObject({ fields: { reason: "refusal", index: 2, question: answer.answers[2]!.name } });
    expect(JSON.stringify(rig.logs)).not.toContain("secret");
  });

  it("records a regex match as IDs and never lets it overrule a successful parse", async () => {
    const { rig, run } = parser();
    rig.openai.script("decisions.create", ok(decisionAnswer()));
    const r = await run("I'm allergic to Mondays");
    expect(r.regex).toEqual(["RX4"]);
    expect(r.parse).toEqual({ kind: "ordinary" });
    expect(rig.logs).toContainEqual({ event: "turn.regex", fields: { turnId: "t1", ids: ["RX4"] } });
    expect(JSON.stringify(rig.logs)).not.toContain("Mondays");
  });
});
