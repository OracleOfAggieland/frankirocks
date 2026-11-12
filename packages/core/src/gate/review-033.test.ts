/** The review of the Gate (brief 033): each finding on the reviewer's own inputs. */
import { describe, expect, it } from "vitest";
import { testId } from "../testing/samples";
import { S2_SCREEN_ASK_BUILT, gate } from "./gate";
import { gateCand, gateCtx, ownerSaid } from "./testing/cases";

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

describe("finding 15: an asked S2 recall goes to a card until the screen ask exists", () => {
  it("cards the opened-topic owner recall in both builds, behind one constant", () => {
    expect(S2_SCREEN_ASK_BUILT).toBe(false);
    const c = gateCand({ sens: "S2", topic: work, queryTerms: ["work"] });
    const asked = { trigger: "recall" as const, ownerTurn: ownerSaid("how is work"), openedTopics: [WORK] };
    expect(gate(c, gateCtx(asked))).toMatchObject({ verdict: "card", carveOut: "openedTopicRecall" });
    // In +200 too: an asked recall is answered as asked (finding 17), not by the door.
    expect(gate(c, gateCtx({ ...asked, build: "plus200" }))).toMatchObject({ verdict: "card", carveOut: "openedTopicRecall" });
  });
});

describe("finding 17: an asked recall is answered as asked, not by an unprompted path", () => {
  it("does not let company open what rushed held (the committed subtract-only property, seed 2120965385)", () => {
    const c = gateCand({ sens: "S2", topic: { ...work, terms: [] }, aliases: ["biopsy"] });
    const wide = gateCtx({ build: "plus200", modifiers: { rushed: true, crisis: false }, trigger: "recall", ownerTurn: ownerSaid("biopsy"), openedTopics: [WORK] });
    const w = gate(c, wide);
    const n = gate(c, { ...wide, audience: "company" });
    expect(w).toMatchObject({ verdict: "card", carveOut: "openedTopicRecall" });
    expect(n.verdict).toBe("card");
  });
});

describe("finding 3: only the owner's words against the candidate's own terms ask", () => {
  it("does not count the model's query terms as asked", () => {
    const c = gateCand({ sens: "S1", queryTerms: ["long day mom"], aliases: ["mom"] });
    const recall = { trigger: "recall" as const };
    expect(gate(c, gateCtx({ ...recall, ownerTurn: ownerSaid("Long day") })).verdict).toBe("silent");
    expect(gate(c, gateCtx({ ...recall, ownerTurn: ownerSaid("How's my mom?") })).verdict).toBe("say");
    expect(gate({ ...c, queryTerms: [] }, gateCtx({ ...recall, ownerTurn: ownerSaid("How's my mom?") })).verdict).toBe("say");
  });

  it("asks through the candidate's own topic, never a third-party label", () => {
    const c = gateCand({ sens: "S1", topic: work });
    expect(gate(c, gateCtx({ trigger: "recall", ownerTurn: ownerSaid("how is work") })).verdict).toBe("say");
    expect(gate({ ...c, topic: { ...work, labelClass: "T" } }, gateCtx({ trigger: "recall", ownerTurn: ownerSaid("how is work") })).verdict).toBe("silent");
  });
});

describe("finding 18: a label opens only on all of its words", () => {
  it("does not drop a label's function words before matching (the committed ceiling property, seed 555205424)", () => {
    const c = gateCand({ sourceClass: "M", topic: { ...work, label: "is biopsy", terms: [] } });
    expect(gate(c, gateCtx({ ownerTurn: ownerSaid("biopsy") })).verdict).toBe("silent");
    expect(gate(c, gateCtx({ ownerTurn: ownerSaid("is it the biopsy") })).verdict).toBe("say");
    // A label of function words alone never opens.
    expect(gate({ ...c, topic: { ...work, label: "it is", terms: [] } }, gateCtx({ ownerTurn: ownerSaid("it is") })).verdict).toBe("silent");
  });
});
