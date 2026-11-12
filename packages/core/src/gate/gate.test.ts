/** The Gate on the spec's own examples (brief 024; spec §6). */
import { describe, expect, it } from "vitest";
import { docRef } from "../eligible";
import { testId } from "../testing/samples";
import { buildStore, storeCase } from "../testing/memory-store-arb";
import fc from "fast-check";
import { HARD_RULE_FAIL_LINE, PROACTIVE_PER_DAY, gate } from "./gate";
import { memoryCandidate } from "./memory";
import { inQuietHours } from "./quiet-hours";
import type { GateCandidate, GateContext } from "./types";

const NOW = "2026-11-12T17:00:00.000Z"; // 09:00 in Los Angeles
const DAD = testId("topic-dad");

function cand(o: Partial<GateCandidate> = {}): GateCandidate {
  return {
    id: testId("c1"),
    kind: "memory",
    subjectId: "e:mom",
    sourceClass: "U",
    sens: "S0",
    allergy: false,
    eligibility: { allow: true, reason: "ok" },
    toldAt: null,
    topic: null,
    queryTerms: [],
    // Brief 033 finding 3: these cases' query terms stood for the candidate's own aliases, so they are kept as such.
    aliases: o.queryTerms ?? [],
    purpose: "item",
    gravity: 0,
    food: false,
    mustSay: null,
    dueAt: null,
    sender: null,
    attestedPremises: 0,
    offerUsed: false,
    ownRooted: false,
    checkInUsed: false,
    act: "say",
    ...o,
  };
}

function ctx(o: Partial<GateContext> = {}): GateContext {
  return {
    worldNow: NOW,
    zone: "America/Los_Angeles",
    build: "floor",
    audience: "private",
    modifiers: { rushed: false, crisis: false },
    trigger: "unprompted",
    // Brief 033 finding 7: an unprompted context names its moment.
    moment: "idle",
    ownerTurn: null,
    openedTopics: [],
    recentTurns: [],
    counts: { proactive: 0, heavy: 0, senderAsks: 0, notesThisReply: 0 },
    rules: "ready",
    authorization: null,
    ...o,
  };
}

const said = (text: string) => ({ text, sourceClass: "U" as const, certain: true });
const dadTopic = { topicId: DAD, label: "Dad's health", labelClass: "U" as const, terms: ["houston"], quiet: null };

describe("gate: the spec's examples", () => {
  it("says a told S0 item unprompted", () => {
    expect(gate(cand(), ctx())).toMatchObject({ verdict: "say", form: "item", render: "free", reasons: ["ok"] });
  });

  it("does not count recall(\"mom\") after \"Long day\" as asked", () => {
    const c = cand({ queryTerms: ["mom"], sens: "S1" });
    expect(gate(c, ctx({ trigger: "recall", ownerTurn: said("Long day") })).verdict).toBe("silent");
    expect(gate(c, ctx({ trigger: "recall", ownerTurn: said("How's my mom?") })).verdict).toBe("say");
    // An uncertain speaker or pasted text never asks.
    expect(gate(c, ctx({ trigger: "recall", ownerTurn: { ...said("How's my mom?"), certain: false } })).verdict).toBe("silent");
    expect(gate(c, ctx({ trigger: "recall", ownerTurn: { ...said("How's my mom?"), sourceClass: "T" } })).verdict).toBe("silent");
  });

  it("opens Dad's door on \"I can't keep driving to Houston every week\", and the alias alone does not", () => {
    const c = cand({ sourceClass: "M", sens: "S1", topic: dadTopic });
    expect(gate(c, ctx({ ownerTurn: said("I can't keep driving to Houston every week") }))).toMatchObject({ verdict: "say", render: "hedged" });
    expect(gate(c, ctx({ ownerTurn: said("What time does Ana arrive?") })).verdict).toBe("silent");
    // A label from third-party text never opens a door.
    expect(gate(cand({ ...c, topic: { ...dadTopic, labelClass: "T" } }), ctx({ ownerTurn: said("Houston") })).verdict).toBe("silent");
  });

  it("gives Alex nothing aloud for \"When's her interview?\" in company", () => {
    const c = cand({ sens: "S1", queryTerms: ["interview"] });
    const r = gate(c, ctx({ audience: "company", trigger: "recall", ownerTurn: { ...said("When's her interview?"), certain: false } }));
    expect(r.verdict).not.toBe("say");
    // The owner asking in company gets a card.
    expect(gate(c, ctx({ audience: "company", trigger: "recall", ownerTurn: said("When's my interview?") })).verdict).toBe("card");
  });

  it("speaks third-party mail by sender only when the owner has mailed them, otherwise a card", () => {
    expect(gate(cand({ sourceClass: "T", sender: { mailedByOwner: true } }), ctx())).toMatchObject({ verdict: "say", render: "attributed" });
    expect(gate(cand({ sourceClass: "T", sender: { mailedByOwner: false } }), ctx()).verdict).toBe("card");
    const ask = cand({ sourceClass: "T", sens: "S1", purpose: "ask", sender: { mailedByOwner: true } });
    expect(gate(ask, ctx())).toMatchObject({ verdict: "say", render: "attributed" });
    expect(gate(ask, ctx({ counts: { proactive: 0, heavy: 0, senderAsks: 1, notesThisReply: 0 } }))).toMatchObject({ verdict: "card", reasons: ["senderCap"] });
    // A sender the owner never mailed gets a card, even for logistics.
    expect(gate(cand({ sourceClass: "T", sens: "S1", purpose: "logistics", sender: { mailedByOwner: false } }), ctx()).verdict).toBe("card");
  });

  it("makes one offer from two attested premises, and stays silent on a guess otherwise", () => {
    expect(gate(cand({ sourceClass: "M", attestedPremises: 2 }), ctx())).toMatchObject({ verdict: "say", render: "offer" });
    expect(gate(cand({ sourceClass: "M", attestedPremises: 2, offerUsed: true }), ctx()).verdict).toBe("silent");
    expect(gate(cand({ sourceClass: "M", attestedPremises: 1 }), ctx()).verdict).toBe("silent");
  });

  it("keeps S2 off the wire in the floor build, and lets the opened-topic owner recall through", () => {
    const c = cand({ sens: "S2", topic: dadTopic, queryTerms: ["dad"], toldAt: NOW });
    expect(gate(c, ctx())).toMatchObject({ verdict: "hold", reasons: ["ceiling"] });
    expect(gate(c, ctx({ trigger: "recall", ownerTurn: said("how is dad") })).verdict).toBe("hold");
    // Brief 033 finding 15: until the screen ask exists, the opened-topic owner recall goes to a card.
    expect(gate(c, ctx({ trigger: "recall", ownerTurn: said("how is dad doing in houston") }))).toMatchObject({ verdict: "card", carveOut: "openedTopicRecall" });
    expect(gate(c, ctx({ trigger: "jarTap" }))).toMatchObject({ verdict: "card", carveOut: "jarTap" });
    // Allergies are exempt from S2 gates.
    expect(gate(cand({ sens: "S2", allergy: true }), ctx()).verdict).toBe("say");
  });

  it("asks one named check-in in the +200 build, alone, within 7 days", () => {
    const c = cand({ sens: "S2", toldAt: "2026-11-08T17:00:00.000Z" });
    expect(gate(c, ctx({ build: "plus200" }))).toMatchObject({ verdict: "say", form: "checkIn", render: "template", carveOut: "checkIn" });
    expect(gate(c, ctx({ build: "plus200", audience: "unknown" })).verdict).toBe("hold");
    expect(gate(cand({ ...c, toldAt: "2026-11-01T17:00:00.000Z" }), ctx({ build: "plus200" })).verdict).toBe("hold");
    expect(gate(cand({ ...c, checkInUsed: true, topic: dadTopic }), ctx({ build: "plus200" }))).toMatchObject({ verdict: "say", form: "door" });
  });

  it("uses an exact private authorization once, in the +200 build only", () => {
    const c = cand({ sens: "S2", topic: dadTopic, checkInUsed: true });
    const authorization = { subjectId: "e:mom", topicId: DAD, momentId: c.id, audience: "private" as const, expiresAt: "2026-12-01T00:00:00.000Z", used: false, sourceClass: "U" as const };
    expect(gate({ ...c, topic: null }, ctx({ build: "plus200", authorization: { ...authorization, topicId: null } }))).toMatchObject({ verdict: "say", carveOut: "authorization" });
    expect(gate({ ...c, topic: null }, ctx({ build: "plus200", authorization: { ...authorization, topicId: null, used: true } })).verdict).toBe("hold");
    expect(gate({ ...c, topic: null }, ctx({ authorization: { ...authorization, topicId: null } })).verdict).toBe("hold");
  });

  it("lets \"don't bring it up\" beat an authorization, and an asked recall through", () => {
    const quietTopic = { ...dadTopic, quiet: "unsolicited" as const };
    const c = cand({ sens: "S1", topic: quietTopic, queryTerms: ["dad"] });
    const authorization = { subjectId: "e:mom", topicId: DAD, momentId: c.id, audience: "private" as const, expiresAt: "2026-12-01T00:00:00.000Z", used: false, sourceClass: "U" as const };
    expect(gate(c, ctx({ build: "plus200", authorization }))).toMatchObject({ verdict: "silent", reasons: ["quiet"] });
    expect(gate(c, ctx({ trigger: "recall", ownerTurn: said("how is dad") })).verdict).toBe("say");
    expect(gate(cand({ ...c, topic: { ...quietTopic, quiet: "all_output" } }), ctx({ trigger: "recall", ownerTurn: said("how is dad") })).verdict).toBe("silent");
  });

  it("fails closed on food without rule data, with the fixed line", () => {
    expect(gate(cand({ food: true }), ctx({ rules: "missing" }))).toMatchObject({ verdict: "silent", fixedLine: HARD_RULE_FAIL_LINE, reasons: ["rulesUnavailable"] });
    expect(gate(cand({ food: true }), ctx()).verdict).toBe("say");
  });

  it("holds over the day's cap, in quiet hours and after a check-in answer, unless a floor is proven", () => {
    const capped = ctx({ counts: { proactive: PROACTIVE_PER_DAY, heavy: 0, senderAsks: 0, notesThisReply: 0 } });
    expect(gate(cand(), capped)).toMatchObject({ verdict: "hold", reasons: ["cap"] });
    expect(gate(cand({ mustSay: "commitmentDue", dueAt: "2026-11-13T09:00:00.000Z" }), capped)).toMatchObject({ verdict: "say", mustSay: "commitmentDue" });
    expect(gate(cand({ mustSay: "commitmentDue", dueAt: "2026-11-14T09:00:00.000Z" }), capped)).toMatchObject({ verdict: "hold", reasons: ["mustSayUnproven", "cap"] });
    expect(gate(cand(), ctx({ worldNow: "2026-11-13T06:00:00.000Z" })).reasons).toContain("quietHours");
    const answered = ctx({ recentTurns: [{ role: "user", checkInAnswer: true, transitionOrCrisis: false }] });
    expect(gate(cand({ purpose: "insight" }), answered)).toMatchObject({ verdict: "hold", reasons: ["afterCheckIn"] });
    expect(gate(cand({ purpose: "item" }), answered).verdict).toBe("say");
  });

  it("lets a floor skip the caps only, never a crisis or the hold after a check-in answer", () => {
    const due = cand({ purpose: "ask", mustSay: "commitmentDue", dueAt: "2026-11-13T09:00:00.000Z" });
    expect(gate(due, ctx({ modifiers: { rushed: false, crisis: true } })).verdict).toBe("hold");
    expect(gate(due, ctx({ recentTurns: [{ role: "user", checkInAnswer: false, transitionOrCrisis: true }] })).verdict).toBe("hold");
    // A floor is proven by code: a third party's commitment or a non-food hard-rule claim is not one.
    expect(gate(cand({ ...due, sourceClass: "T", sender: { mailedByOwner: true }, sens: "S1" }), ctx()).mustSay).toBeNull();
    expect(gate(cand({ mustSay: "hardRuleConflict" }), ctx()).mustSay).toBeNull();
  });

  it("does not let a function word ask, or an earlier opened topic raise a guess", () => {
    expect(gate(cand({ sens: "S1", queryTerms: ["is mom ok"] }), ctx({ trigger: "recall", ownerTurn: said("It is late") })).verdict).toBe("silent");
    expect(gate(cand({ sourceClass: "M", sens: "S1", topic: dadTopic }), ctx({ openedTopics: [DAD] })).verdict).toBe("silent");
  });

  it("holds suggesting and celebrating in a crisis, and a second note when rushed", () => {
    expect(gate(cand({ purpose: "celebrate" }), ctx({ modifiers: { rushed: false, crisis: true } })).verdict).toBe("hold");
    expect(gate(cand(), ctx({ modifiers: { rushed: true, crisis: false }, counts: { proactive: 0, heavy: 0, senderAsks: 0, notesThisReply: 1 } })).verdict).toBe("hold");
  });

  it("renders S1 through a template while the audience is unknown", () => {
    // Brief 033 finding 7: only a Franki-started opener gets S1 by template; an idle S1 line is held (review-033.test.ts).
    expect(gate(cand({ sens: "S1" }), ctx({ audience: "unknown", moment: "opener" }))).toMatchObject({ verdict: "say", render: "template" });
  });

  it("never says a reason that is only used", () => {
    expect(gate(cand({ act: "use" }), ctx())).toMatchObject({ verdict: "silent", form: "use", reasons: ["useOnly"] });
  });

  it("is silent on malformed input, never throwing", () => {
    expect(gate(null as unknown as GateCandidate, ctx()).verdict).toBe("silent");
    expect(gate(cand(), { ...ctx(), worldNow: "not a time" }).verdict).toBe("silent");
  });

  it("reads quiet hours in the world zone", () => {
    expect(inQuietHours(Date.parse("2026-11-13T05:29:00.000Z"), "America/Los_Angeles")).toBe(false); // 21:29 PST
    expect(inQuietHours(Date.parse("2026-11-13T05:30:00.000Z"), "America/Los_Angeles")).toBe(true); // 21:30 PST
    expect(inQuietHours(Date.parse("2026-11-12T16:00:00.000Z"), "America/Los_Angeles")).toBe(false); // 08:00 PST
    expect(inQuietHours(Date.parse("2026-11-12T15:59:00.000Z"), "America/Los_Angeles")).toBe(true);
    expect(inQuietHours(0, "Not/AZone")).toBe(true);
  });

  it("computes eligibility from the stored row in memoryCandidate", () => {
    fc.assert(
      fc.property(storeCase(), (k) => {
        const s = buildStore(k);
        for (const r of s.rows.slice(0, 3)) {
          const x = { ref: docRef("memories", r.id, r.memory.rev), row: r.memory };
          const c = memoryCandidate(x, s.ctx.ec, s.snapshot, { ...cand(), topic: null });
          if (c.eligibility.allow) expect(r.memory.status).toBe("active");
          expect(c.sens).toBe(r.memory.sens);
        }
      }),
      { numRuns: 50 },
    );
  });
});
