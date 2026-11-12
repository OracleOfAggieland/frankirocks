/** The review of the Gate (brief 033): each finding on the reviewer's own inputs. */
import { describe, expect, it } from "vitest";
import { testId } from "../testing/samples";
import { gate } from "./gate";
import { gateCand, gateCtx } from "./testing/cases";

const WORK = testId("topic-work");
const work = { topicId: WORK, label: "work", labelClass: "U" as const, terms: ["work"], quiet: null };
const counts = (o: Partial<ReturnType<typeof gateCtx>["counts"]> = {}) => ({ proactive: 0, heavy: 0, senderAsks: 0, notesThisReply: 0, ...o });

describe("finding 1: an opened topic never lifts unprompted mail", () => {
  const opened = gateCtx({ openedTopics: [WORK] });

  it("keeps the sender cap card for a T S1 ask", () => {
    const c = gateCand({ sourceClass: "T", sens: "S1", purpose: "ask", sender: { mailedByOwner: true }, topic: work });
    const capped = { ...opened, counts: counts({ senderAsks: 5 }) };
    expect(gate(c, capped)).toMatchObject({ verdict: "card", reasons: ["senderCap"] });
    expect(gate(c, { ...capped, openedTopics: [] })).toMatchObject({ verdict: "card", reasons: ["senderCap"] });
  });

  it("cards T S0 mail from a sender the owner never mailed", () => {
    expect(gate(gateCand({ sourceClass: "T", sender: { mailedByOwner: false }, topic: work }), opened).verdict).toBe("card");
  });

  it("cards a T S1 insight with no sender", () => {
    expect(gate(gateCand({ sourceClass: "T", sens: "S1", purpose: "insight", sender: null, topic: work }), opened).verdict).toBe("card");
  });
});

describe("finding 14: one T ask per sender per day, at any sensitivity", () => {
  it("cards a T S0 ask from a mailed sender over the cap", () => {
    const c = gateCand({ sourceClass: "T", purpose: "ask", sender: { mailedByOwner: true } });
    expect(gate(c, gateCtx({ counts: counts({ senderAsks: 9 }) }))).toMatchObject({ verdict: "card", reasons: ["senderCap"] });
    expect(gate(c, gateCtx())).toMatchObject({ verdict: "say", render: "attributed" });
  });
});
