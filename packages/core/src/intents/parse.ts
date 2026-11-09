/**
 * The TurnIntents response: parser, normalize, candidates, priority and the ordinary test (contracts §5; R10.6,
 * R10.7; design "The slow parse"). Pure. The input mirrors the `openai` package's `Decision`.
 */
import { CANDIDATE_P, CONTROL_CLASSES, type ControlClass, INTENT_NAMES, type IntentName, PRIORITY, UNCERTAIN_SPEAKER_P } from "./classes";
import type { PredicateQuestion } from "./request";

export type Probabilities = Record<IntentName, number>;

export interface Intents {
  p: Probabilities;
  opens: { topicId: string; p: number }[];
}

export type ParsedDecision = { ok: true; intents: Intents } | { ok: false; why: "invalid" };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isProbability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * Matches answers to questions by position and name. A refusal, a wrong type, a missing or extra answer, a name
 * that differs, or a probability that is not finite in [0, 1] fails the whole parse (contracts §5
 * "refusal/missing/extra=hold").
 */
export function parseDecision(raw: unknown, questions: readonly PredicateQuestion[]): ParsedDecision {
  const fail: ParsedDecision = { ok: false, why: "invalid" };
  if (!isRecord(raw) || !Array.isArray(raw.answers) || raw.answers.length !== questions.length) return fail;
  const p: Partial<Probabilities> = {};
  const opens: Intents["opens"] = [];
  for (let i = 0; i < questions.length; i++) {
    const a = raw.answers[i];
    const q = questions[i]!;
    if (!isRecord(a) || a.type !== "predicate" || a.name !== q.name || !isProbability(a.probability)) return fail;
    if (q.name.startsWith("opens_")) opens.push({ topicId: q.name.slice("opens_".length), p: a.probability });
    else if ((INTENT_NAMES as readonly string[]).includes(q.name)) p[q.name as IntentName] = a.probability;
    else return fail;
  }
  if (INTENT_NAMES.some((n) => p[n] === undefined)) return fail;
  return { ok: true, intents: { p: p as Probabilities, opens } };
}

/** The control classes at or above 0.20, in contracts §5 row order (all are retained). */
export function candidates(p: Probabilities): ControlClass[] {
  return CONTROL_CLASSES.filter((c) => p[c] >= CANDIDATE_P);
}

/** The first candidate in PRIORITY, or null. */
export function choose(cands: readonly ControlClass[]): ControlClass | null {
  return PRIORITY.find((c) => cands.includes(c)) ?? null;
}

/** Contracts §5 "Ordinary=controls<.20,speaker<.10". A regex match does not enter it (design review change 1). */
export function isOrdinary(p: Probabilities): boolean {
  return candidates(p).length === 0 && p.uncertainSpeaker < UNCERTAIN_SPEAKER_P;
}

/** The parse as the Server_Rule reads it. */
export type ParseOutcome =
  | { kind: "ordinary" }
  | { kind: "hit"; chosen: ControlClass | null; candidates: ControlClass[]; uncertain: boolean };

export function outcomeOf(p: Probabilities): ParseOutcome {
  const cands = candidates(p);
  if (isOrdinary(p)) return { kind: "ordinary" };
  return { kind: "hit", chosen: choose(cands), candidates: cands, uncertain: p.uncertainSpeaker >= UNCERTAIN_SPEAKER_P };
}
