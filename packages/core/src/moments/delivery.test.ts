import { describe, expect, it } from "vitest";
import { localMinuteAt } from "../dates";
import { tsFromMs } from "../schema/primitives";
import { sampleCoreDocs, testId } from "../testing/samples";
import { chooseDelivery, countDelivery, type DeliveryCandidate, todayCounts } from "./delivery";
import { deriveOccasion } from "./derive";
import { momentRow } from "./merge";
import { matchSaid, saidTargetOf, saidUpdate } from "./said";
import { memId, momentHasher, occasionMemory } from "./testing/arb-moments";

const ZONE = "America/Chicago";
const at = (minute: number) => localMinuteAt("2026-11-13", minute, ZONE)!;
const cand = (id: string, kind: DeliveryCandidate["kind"], over: Partial<DeliveryCandidate> = {}): DeliveryCandidate => ({ momentId: id, kind, dueAt: at(8 * 60), heavy: false, mustSay: false, override: null, ...over });
const input = (candidates: DeliveryCandidate[], over: Partial<Parameters<typeof chooseDelivery>[0]> = {}) => ({
  candidates,
  mode: { kind: "opening" as const },
  transitionOrCrisis: false,
  turnsSinceCheckInAnswer: null,
  today: { proactive: 0, heavy: 0 },
  worldNow: at(8 * 60 + 40),
  zone: ZONE,
  ...over,
});

describe("chooseDelivery", () => {
  it("an opening line goes by priority: wish before check-in before insight; the rest are cards", () => {
    const out = chooseDelivery(input([cand("i", "insight"), cand("c", "checkIn"), cand("w", "wish"), cand("x", "celebrate")]));
    expect(out.spoken).toEqual({ momentId: "w", channel: "opening" });
    expect(out.cards).toEqual(["c", "i"]);
    expect(out.reasons.find((r) => r.momentId === "x")?.code).toBe("cardLimit");
  });

  it("an open session whispers only when listening and silent for 8 s", () => {
    expect(chooseDelivery(input([cand("c", "checkIn")], { mode: { kind: "session", listening: true, silentMs: 7_999 } })).spoken).toBeNull();
    expect(chooseDelivery(input([cand("c", "checkIn")], { mode: { kind: "session", listening: true, silentMs: 8_000 } })).spoken).toEqual({ momentId: "c", channel: "whisper" });
  });

  it("quiet hours and the caps make a card, mustSay passes both", () => {
    expect(chooseDelivery(input([cand("c", "checkIn")], { worldNow: at(21 * 60 + 30) })).reasons[0]?.code).toBe("quietHours");
    expect(chooseDelivery(input([cand("c", "checkIn")], { today: { proactive: 3, heavy: 0 } })).reasons[0]?.code).toBe("dayCap");
    expect(chooseDelivery(input([cand("c", "checkIn", { heavy: true })], { today: { proactive: 1, heavy: 1 } })).reasons[0]?.code).toBe("heavyCap");
    expect(chooseDelivery(input([cand("m", "commitmentDue", { mustSay: true })], { worldNow: at(23 * 60), today: { proactive: 9, heavy: 9 } })).spoken?.momentId).toBe("m");
  });

  it("no insight or celebrate after a check-in answer or with a transition candidate", () => {
    expect(chooseDelivery(input([cand("i", "insight")], { turnsSinceCheckInAnswer: 1 })).reasons[0]?.code).toBe("afterCheckIn");
    expect(chooseDelivery(input([cand("i", "insight")], { turnsSinceCheckInAnswer: 2 })).spoken?.momentId).toBe("i");
    expect(chooseDelivery(input([cand("l", "celebrate")], { transitionOrCrisis: true })).reasons[0]?.code).toBe("transitionHold");
  });

  it("countDelivery counts speech and heavy per world day", () => {
    const counters = sampleCoreDocs().counters;
    const once = countDelivery(counters, "2026-11-13", true);
    expect(todayCounts(once, "2026-11-13")).toEqual({ proactive: 1, heavy: 1 });
    const twice = countDelivery(once, "2026-11-13", false);
    expect(todayCounts(twice, "2026-11-13")).toEqual({ proactive: 2, heavy: 1 });
    expect(todayCounts(countDelivery(twice, "2026-11-14", false), "2026-11-14")).toEqual({ proactive: 1, heavy: 0 });
  });
});

describe("said", () => {
  const m = occasionMemory(memId(1), { zone: ZONE, startMs: at(14 * 60), precision: "instant", endMinutes: null, extraDays: 0 });
  const plan = deriveOccasion(m, new Map([[m.logicalId, m]]), momentHasher).plans[0]!;
  const row = momentRow(plan, { uid: "owner-1", opsNow: at(8 * 60), epoch: 1, policyRev: 1, clockMode: "fixture" }, momentHasher);
  const admitted = { ...row, status: "admitted" as const, admittedAt: tsFromMs(at(8 * 60 + 41)), responseId: "resp_1" };
  const receipt = (text: string | null, kind: "transcript" | "admitted" = "transcript") => ({ kind, responseId: "resp_1", momentIds: [plan.momentId], noteIds: [], text });

  it("an admitted moment is said by its template, in any case and punctuation", () => {
    expect(saidUpdate(admitted, receipt("Morning! good luck at 2 pm: tessellate labs final interview"), saidTargetOf(plan.momentId, admitted), 1)).toEqual({ saidAt: 1, saidMatch: "exactTemplate" });
  });

  it("no admission, another response, no transcript or no match: saidAt stays null", () => {
    const target = saidTargetOf(plan.momentId, admitted);
    const text = "Good luck at 2 PM: Tessellate Labs final interview.";
    expect(saidUpdate(row, receipt(text), target, 1)).toBeNull();
    expect(saidUpdate({ ...admitted, responseId: "resp_2" }, receipt(text), target, 1)).toBeNull();
    expect(saidUpdate(admitted, receipt(text, "admitted"), target, 1)).toBeNull();
    expect(saidUpdate(admitted, receipt("Good luck today."), target, 1)).toBeNull();
  });

  it("idTagged needs the metadata and every token; candidateAndReason needs both parts", () => {
    const r = receipt("Want Thai Basil? It's quick.");
    expect(matchSaid(r, { momentId: plan.momentId, noteId: null, tokens: ["thai", "basil"], template: null, candidate: null })).toBe("idTagged");
    expect(matchSaid({ ...r, momentIds: [testId("other")] }, { momentId: plan.momentId, noteId: null, tokens: ["thai"], template: null, candidate: null })).toBe("none");
    expect(matchSaid(r, { momentId: testId("x"), noteId: null, tokens: [], template: null, candidate: { name: "Thai Basil", reason: "quick" } })).toBe("candidateAndReason");
    expect(matchSaid(r, { momentId: testId("x"), noteId: null, tokens: [], template: null, candidate: { name: "Thai Basil", reason: "" } })).toBe("none");
  });
});

describe("brief 036 finding 4: crisis and transition are separate", () => {
  it("crisis holds a wish and a check-in; a mustSay still plays", () => {
    const crisis = (cands: DeliveryCandidate[]) => {
      const { transitionOrCrisis: _, ...rest } = input(cands);
      return chooseDelivery({ ...rest, transition: false, crisis: true });
    };
    const out = crisis([cand("w", "wish"), cand("c", "checkIn")]);
    expect(out.spoken).toBeNull();
    expect(out.reasons.map((r) => r.code)).toEqual(["crisisHold", "crisisHold"]);
    expect(crisis([cand("w", "wish"), cand("m", "commitmentDue", { mustSay: true })]).spoken?.momentId).toBe("m");
  });

  it("a transition holds a grief ask, not a wish; the old single flag holds as both", () => {
    const { transitionOrCrisis: _, ...rest } = input([cand("g", "griefAsk"), cand("w", "wish")]);
    const out = chooseDelivery({ ...rest, transition: true, crisis: false });
    expect(out.reasons.find((r) => r.momentId === "g")?.code).toBe("transitionHold");
    expect(out.spoken?.momentId).toBe("w");
    expect(chooseDelivery(input([cand("w", "wish")], { transitionOrCrisis: true })).reasons[0]?.code).toBe("crisisHold");
  });
});
