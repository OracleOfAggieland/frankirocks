import { FORGET_NOT_YET, RECOVERY_LINE, type Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import { paths } from "../store/paths";
import { commitUserTurnForTest, insertMemoryForTest } from "../testing/extract-fixtures";
import { describe, expect, it } from "vitest";
import { never, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { decisionAnswer } from "../testing/decisions";
import { callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { DECISIONS_NO_CALL_DEADLINE_MS } from "../intents/slow-parse";
import { turnRoute } from "./turn";

const UID = "owner-1";
type Rig = ReturnType<typeof testRig>;
const post = (rig: Rig, body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers);
const texts = (body: { notes: { text: string }[] }) => body.notes.map((n) => n.text);

/** A rig whose Decisions answer comes after `ms` of fake time. */
function slowDecisions(rig: Rig, ms: number, answer: unknown) {
  const inner = rig.deps.openai;
  rig.deps.openai = {
    async call(endpoint, body) {
      if (endpoint !== "decisions.create") return inner.call(endpoint, body);
      await rig.deps.timers.sleep(ms);
      return answer;
    },
  };
}

describe("a typed line with no call open (review of wave A, item 17)", () => {
  it("a crisis line shows the typed reply, under scope ack with no fixed line", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    rig.openai.script("decisions.create", ok(decisionAnswer({ crisis: 0.7 })));
    rig.openai.script("responses.create", ok(completed("I'm here with you. Would it help to talk about it?")));
    const { value: res } = await post(rig, typedTurn(s.stamp, 1, "I feel hopeless tonight"));
    expect(res.body).toMatchObject({ permit: { kind: "postCommitControl", scope: "ack" } });
    expect(texts(res.body)).toEqual(["I'm here with you. Would it help to talk about it?"]);
    expect(res.body.permit.noteIds).toEqual([res.body.notes[0].noteId]);
  });

  it("any other hit shows the typed reply", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    rig.openai.script("decisions.create", ok(decisionAnswer({ rushed: 0.5 })));
    rig.openai.script("responses.create", ok(completed("Quickly: it's 3 pm in Denver.")));
    const { value: res } = await post(rig, typedTurn(s.stamp, 1, "quick, what time is it in Denver"));
    expect(res.body.permit.kind).toBe("postCommitControl");
    expect(texts(res.body)).toEqual(["Quickly: it's 3 pm in Denver."]);
  });

  it("a class with a Fixed_Line shows its line, not the typed reply", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    rig.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.9 })));
    rig.openai.script("responses.create", ok(completed("Sure, forgotten.")));
    const { value: res } = await post(rig, typedTurn(s.stamp, 1, "forget what I said about work"));
    expect(texts(res.body)).toEqual([FORGET_NOT_YET]);
  });

  it("a failed parse shows the Neutral_Line as text", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    rig.openai.script("decisions.create", never());
    rig.openai.script("responses.create", ok(completed("A reply that must not show.")));
    const { value: res } = await post(rig, typedTurn(s.stamp, 1, "my dog loves the park"));
    expect(res.body.permit.kind).toBe("recoveryOnly");
    expect(texts(res.body)).toEqual([RECOVERY_LINE]);
  });

  it("the Decisions call starts beside ensureCoreDocs and beginRequest, not after them (review of wave A, item 23)", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    const order: string[] = [];
    const store = rig.deps.store;
    rig.deps.store = { ...store, get: (u, p) => (order.push("get"), store.get(u, p)), query: (u, q) => store.query(u, q), transaction: (u, fn) => (order.push("tx"), store.transaction(u, fn)) };
    const openai = rig.deps.openai;
    rig.deps.openai = { call: (e, b) => (e === "decisions.create" && order.push("decide"), openai.call(e, b)) };
    const { value: res } = await post(rig, typedTurn(s.stamp, 1, "what's a good dog name"));
    expect(res.status).toBe(200);
    expect(order.indexOf("decide")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("decide")).toBeLessThan(order.indexOf("tx"));
  });

  it("the Decisions deadline is 2,000 ms, not 350 ms", async () => {
    expect(DECISIONS_NO_CALL_DEADLINE_MS).toBe(2_000);
    const rig = testRig();
    const s = await openTestSession(rig);
    slowDecisions(rig, 1_000, decisionAnswer());
    rig.openai.script("responses.create", ok(completed("Pip is a good name.")));
    const { value: res } = await post(rig, typedTurn(s.stamp, 1, "what's a good dog name"));
    expect(res.body).toMatchObject({ status: "ordinary", permit: { kind: "slowOrdinary" } });
    expect(texts(res.body)).toEqual(["Pip is a good name."]);
  });
});

describe("a typed hit keeps its reply whatever its sensitivity, when no one else can see it (review of wave A, item 24)", () => {
  /** A Session whose Head holds an S1 Memory, so the typed reply note is S1. */
  async function s1Head() {
    const rig = testRig();
    await openTestSession(rig, "warmup");
    const prior = await commitUserTurnForTest(rig.store, UID, testId("t0"), "My sister works at the bank", rig.clock, rig.deps.hasher);
    await insertMemoryForTest(rig.store, UID, prior, rig.deps.hasher, { sens: "S1" });
    const s = await openTestSession(rig, "open2");
    return { rig, s };
  }

  it("a hit with no Fixed_Line, crisis included, keeps the S1 typed reply in a private audience with no gap", async () => {
    for (const p of [{ rushed: 0.5 }, { crisis: 0.7 }]) {
      const { rig, s } = await s1Head();
      rig.openai.script("decisions.create", ok(decisionAnswer(p)));
      rig.openai.script("responses.create", ok(completed("Your sister is at the bank today.")));
      const { value: res } = await post(rig, typedTurn(s.stamp, 1, "quick, where is my sister"));
      expect(res.body.notes.map((n: { sens: string }) => n.sens), JSON.stringify(p)).toEqual(["S1"]);
      expect(texts(res.body)).toEqual(["Your sister is at the bank today."]);
    }
  });

  it("in another audience, or with a parse gap, it stays limited to S0", async () => {
    for (const patch of [{ audience: "company" as const }, { lastClientSeq: 1, committedParseSeq: 0, nextClientSeq: 2 }]) {
      const { rig, s } = await s1Head();
      await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), patch);
      const seq = "nextClientSeq" in patch ? 2 : 1;
      rig.openai.script("decisions.create", ok(decisionAnswer({ rushed: 0.5 })));
      rig.openai.script("responses.create", ok(completed("Your sister is at the bank today.")));
      const { value: res } = await post(rig, typedTurn(s.stamp, seq, "quick, where is my sister"));
      expect(res.body.permit.kind, JSON.stringify(patch)).toBe("postCommitControl");
      expect(res.body.notes, JSON.stringify(patch)).toEqual([]);
    }
  });

  it("a Fixed_Line class still shows its line", async () => {
    const { rig, s } = await s1Head();
    rig.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.9 })));
    rig.openai.script("responses.create", ok(completed("Sure.")));
    const { value: res } = await post(rig, typedTurn(s.stamp, 1, "forget what I said about my sister"));
    expect(texts(res.body)).toEqual([FORGET_NOT_YET]);
  });
});
