// Brief 040, item 2: in a call, `answer` is a trigger, and code decides. The call sends both IDs null; the route
// resolves the one offer whose `pendingRendered` row binds to this turn (brief 037's binding), and reads the choice
// from the owner's own final words: a plain yes applies, a plain no declines, anything else asks again.
import { describe, expect, it } from "vitest";
import { ANSWER_TOOL, AnswerCall, ToolCall, validate as parse } from "@franki/core";
import { CALL_ANSWER, answerCallSetup } from "../testing/answer-call-fixture";

const state = (res: { body: { result?: { state?: string } | null; status?: string } }) => res.body.result?.state ?? res.body.status;

describe("the answer tool as a call sends it (brief 040, item 2)", () => {
  it("shows the model no parameters", () => {
    expect(ANSWER_TOOL.parameters).toEqual({ type: "object", properties: {}, required: [], additionalProperties: false });
  });

  it("the wire takes both IDs null, and both IDs as a card's tap sends them", () => {
    expect(parse(AnswerCall, CALL_ANSWER).ok).toBe(true);
    expect(parse(ToolCall, CALL_ANSWER).ok).toBe(true);
    expect(parse(AnswerCall, { name: "answer", args: { pendingId: "p".repeat(43), choiceId: "c".repeat(43) } }).ok).toBe(true);
  });

  it("shown, then a plain yes as the next turn: applied, and the list is written once", async () => {
    const t = await answerCallSetup({ turns: ["What's on tomorrow", "Yes, let's do it"], present: 1 });
    const res = await t.tool(CALL_ANSWER);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.result).toMatchObject({ name: "answer", state: "applied", pendingId: t.offer!.pendingId });
    expect(await t.actions()).toHaveLength(1);
  });

  it("shown, then a plain no: declined, nothing written", async () => {
    const t = await answerCallSetup({ turns: ["No thanks"], present: 0 });
    const res = await t.tool(CALL_ANSWER);
    expect(res.body.result).toMatchObject({ state: "declined", pendingId: t.offer!.pendingId });
    expect(await t.actions()).toEqual([]);
  });

  it.each(["Maybe later", "Yes, but not tonight", "Sure, tell me more first", "No, but ask me tomorrow"])("shown, then %j: clarify, nothing written", async (words) => {
    const t = await answerCallSetup({ turns: [words], present: 0 });
    expect(state(await t.tool(CALL_ANSWER))).toBe("clarify");
    expect(await t.actions()).toEqual([]);
  });

  it("never shown: a plain yes is clarify, with no pending ID", async () => {
    const t = await answerCallSetup({ turns: ["Yes"], present: null });
    const res = await t.tool(CALL_ANSWER);
    expect(res.body.result).toMatchObject({ state: "clarify", pendingId: null });
    expect(await t.actions()).toEqual([]);
  });

  it("a yes that isn't the owner's next turn after the offer was shown: clarify", async () => {
    const t = await answerCallSetup({ turns: ["What's on tomorrow", "Yes"], present: 0 });
    expect(state(await t.tool(CALL_ANSWER))).toBe("clarify");
    expect(await t.actions()).toEqual([]);
  });

  it("a no that isn't the owner's next turn after the offer was shown: clarify, not declined", async () => {
    const t = await answerCallSetup({ turns: ["What's on tomorrow", "No"], present: 0 });
    expect(state(await t.tool(CALL_ANSWER))).toBe("clarify");
  });

  it("one null and one ID is clarify, whatever the words, with the offer shown", async () => {
    const t = await answerCallSetup({ turns: ["Yes"], present: 0 });
    for (const args of [
      { pendingId: t.offer!.pendingId, choiceId: null },
      { pendingId: null, choiceId: t.offer!.yesId },
    ]) {
      const res = await t.tool({ name: "answer", args });
      expect(res.status).toBe(200);
      expect(state(res)).toBe("clarify");
    }
    expect(await t.actions()).toEqual([]);
  });

  it("the path with IDs is unchanged: the offer's yes ID and a plain yes apply", async () => {
    const t = await answerCallSetup({ turns: ["Yes"], present: 0 });
    const res = await t.tool({ name: "answer", args: { pendingId: t.offer!.pendingId, choiceId: t.offer!.yesId } });
    expect(state(res)).toBe("applied");
  });
});
