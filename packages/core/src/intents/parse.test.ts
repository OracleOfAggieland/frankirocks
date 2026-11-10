import { describe, expect, it } from "vitest";
import { CONTROL_CLASSES, INTENT_NAMES, PRIORITY } from "./classes";
import { type Probabilities, candidates, choose, isOrdinary, outcomeOf, parseDecision } from "./parse";
import { turnIntentsQuestions } from "./request";

const QUESTIONS = turnIntentsQuestions([]);
const zero = (): Probabilities => Object.fromEntries(INTENT_NAMES.map((n) => [n, 0])) as Probabilities;
const answers = (p: Probabilities) => ({ answers: INTENT_NAMES.map((name): { type: string; name: string; probability: unknown } => ({ type: "predicate", name, probability: p[name] })), model: "m", usage: {} });

describe("parseDecision", () => {
  it("maps answers by position and name", () => {
    const p = { ...zero(), forget: 0.9, uncertainSpeaker: 0.05 };
    expect(parseDecision(answers(p), QUESTIONS)).toEqual({ ok: true, intents: { p, opens: [] } });
  });

  it("reads opens rows", () => {
    const qs = turnIntentsQuestions([{ topicId: "t1", label: "x", terms: [] }]);
    const raw = answers(zero());
    raw.answers.push({ type: "predicate", name: "opens_t1", probability: 0.6 });
    expect(parseDecision(raw, qs)).toMatchObject({ ok: true, intents: { opens: [{ topicId: "t1", p: 0.6 }] } });
  });

  it("fails on a refusal, a wrong type, a missing or extra answer, a name mismatch or a bad probability", () => {
    const fail = { ok: false, why: "invalid" };
    const base = () => answers(zero());
    const refusal = base();
    refusal.answers[3] = { type: "refusal", name: refusal.answers[3]!.name } as never;
    expect(parseDecision(refusal, QUESTIONS)).toMatchObject(fail);
    const choice = base();
    (choice.answers[0] as { type: string }).type = "choice";
    expect(parseDecision(choice, QUESTIONS)).toMatchObject(fail);
    const missing = base();
    missing.answers.pop();
    expect(parseDecision(missing, QUESTIONS)).toMatchObject(fail);
    const extra = base();
    extra.answers.push({ type: "predicate", name: "extra", probability: 0 });
    expect(parseDecision(extra, QUESTIONS)).toMatchObject(fail);
    const swapped = base();
    [swapped.answers[0], swapped.answers[1]] = [swapped.answers[1]!, swapped.answers[0]!];
    expect(parseDecision(swapped, QUESTIONS)).toMatchObject(fail);
    for (const bad of [Number.NaN, -0.01, 1.01, Number.POSITIVE_INFINITY, "0.5"]) {
      const b = base();
      (b.answers[2] as { probability: unknown }).probability = bad;
      expect(parseDecision(b, QUESTIONS)).toMatchObject(fail);
    }
    expect(parseDecision(null, QUESTIONS)).toMatchObject(fail);
    expect(parseDecision({ answers: "x" }, QUESTIONS)).toMatchObject(fail);
  });
});

describe("candidates, choose and isOrdinary", () => {
  it("a class is a candidate at 0.20, not at 0.1999", () => {
    expect(candidates({ ...zero(), food: 0.2 })).toEqual(["food"]);
    expect(candidates({ ...zero(), food: 0.1999 })).toEqual([]);
  });

  it("chooses in PRIORITY order, why before food, and retains every candidate", () => {
    expect(PRIORITY).toEqual(["forget", "company", "quiet", "alone", "crisis", "hardRule", "correct", "transition", "why", "food", "action", "answer", "rushed"]);
    expect([...PRIORITY].sort()).toEqual([...CONTROL_CLASSES].sort());
    const p = { ...zero(), food: 0.9, why: 0.3, rushed: 0.5 };
    expect(choose(candidates(p))).toBe("why");
    expect(outcomeOf(p)).toEqual({ kind: "hit", chosen: "why", candidates: ["why", "rushed", "food"], uncertain: false });
    expect(choose(candidates({ ...zero(), crisis: 0.9, company: 0.3 }))).toBe("company");
    expect(choose([])).toBeNull();
  });

  it("ordinary is controls under 0.20 and uncertainSpeaker under 0.10", () => {
    expect(isOrdinary(zero())).toBe(true);
    expect(isOrdinary({ ...zero(), uncertainSpeaker: 0.0999, forget: 0.19 })).toBe(true);
    expect(isOrdinary({ ...zero(), uncertainSpeaker: 0.1 })).toBe(false);
    expect(outcomeOf({ ...zero(), uncertainSpeaker: 0.4 })).toEqual({ kind: "hit", chosen: null, candidates: [], uncertain: true });
    expect(outcomeOf(zero())).toEqual({ kind: "ordinary" });
  });
});

describe("parseDecision says which check failed (review of the live run, item 4)", () => {
  const base = () => answers(zero());
  const name = (i: number) => QUESTIONS[i]!.name;
  it("names the check and the question, never the words", () => {
    const refusal = base();
    refusal.answers[3] = { type: "refusal", name: name(3) } as never;
    expect(parseDecision(refusal, QUESTIONS)).toEqual({ ok: false, why: "invalid", reason: "refusal", index: 3, name: name(3) });
    const choice = base();
    (choice.answers[0] as { type: string }).type = "choice";
    expect(parseDecision(choice, QUESTIONS)).toEqual({ ok: false, why: "invalid", reason: "type", index: 0, name: name(0) });
    const missing = base();
    missing.answers.pop();
    expect(parseDecision(missing, QUESTIONS)).toEqual({ ok: false, why: "invalid", reason: "count", index: null, name: null });
    const swapped = base();
    [swapped.answers[0], swapped.answers[1]] = [swapped.answers[1]!, swapped.answers[0]!];
    expect(parseDecision(swapped, QUESTIONS)).toEqual({ ok: false, why: "invalid", reason: "name", index: 0, name: name(0) });
    const bad = base();
    (bad.answers[2] as { probability: unknown }).probability = 1.01;
    expect(parseDecision(bad, QUESTIONS)).toEqual({ ok: false, why: "invalid", reason: "probability", index: 2, name: name(2) });
    expect(parseDecision(null, QUESTIONS)).toEqual({ ok: false, why: "invalid", reason: "shape", index: null, name: null });
  });
});