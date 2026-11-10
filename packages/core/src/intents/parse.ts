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

/** Which check an invalid Decision failed (review of the live run, item 4). Names a question, never the words. */
export type InvalidReason = "shape" | "count" | "type" | "refusal" | "name" | "probability" | "missing";
export const INVALID_REASONS: readonly InvalidReason[] = ["shape", "count", "type", "refusal", "name", "probability", "missing"];
export interface InvalidDecision {
  ok: false;
  why: "invalid";
  reason: InvalidReason;
  /** The answer's position, when one answer failed. */
  index: number | null;
  /** That question's name (a TurnIntents predicate or `opens_<topicId>`), when one answer failed. */
  name: string | null;
}

export type ParsedDecision = { ok: true; intents: Intents } | InvalidDecision;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isProbability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const invalid = (reason: InvalidReason, index: number | null = null, name: string | null = null): InvalidDecision => ({ ok: false, why: "invalid", reason, index, name });

/**
 * Matches answers to questions by position and name. A refusal, a wrong type, a missing or extra answer, a name
 * that differs, or a probability that is not finite in [0, 1] fails the whole parse (contracts §5
 * "refusal/missing/extra=hold"), and the failure says which check and which question.
 */
export function parseDecision(raw: unknown, questions: readonly PredicateQuestion[]): ParsedDecision {
  if (!isRecord(raw) || !Array.isArray(raw.answers)) return invalid("shape");
  if (raw.answers.length !== questions.length) return invalid("count");
  const p: Partial<Probabilities> = {};
  const opens: Intents["opens"] = [];
  for (let i = 0; i < questions.length; i++) {
    const a = raw.answers[i];
    const q = questions[i]!;
    if (!isRecord(a)) return invalid("type", i, q.name);
    if (a.type === "refusal") return invalid("refusal", i, q.name);
    if (a.type !== "predicate") return invalid("type", i, q.name);
    if (a.name !== q.name) return invalid("name", i, q.name);
    if (!isProbability(a.probability)) return invalid("probability", i, q.name);
    if (q.name.startsWith("opens_")) opens.push({ topicId: q.name.slice("opens_".length), p: a.probability });
    else if ((INTENT_NAMES as readonly string[]).includes(q.name)) p[q.name as IntentName] = a.probability;
    else return invalid("name", i, q.name);
  }
  const absent = INTENT_NAMES.find((n) => p[n] === undefined);
  if (absent !== undefined) return invalid("missing", null, absent);
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
