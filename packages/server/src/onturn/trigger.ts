/**
 * When the on-turn hardRule route opens (brief 012 design 3.0, 6.1; G19, G34). Pure.
 *
 * - At arrival: RX4 on the final transcript of a U turn. Pasted text (T), `missing` or `failed` transcripts and
 *   superseding posts never trigger here (a supersede and a repair run the route through `late.ts`).
 * - At arrival plus the `core/rules` read: the owner's allergy question is `asked` in this Session.
 * - At the parse: a hardRule candidate at `CANDIDATE_P` or more, read from the probabilities, so an uncertain
 *   speaker's hit (which lists no candidates) still opens the route and fails closed.
 */
import { CANDIDATE_P, type CoreRules, REGEX_TABLE, UNCERTAIN_SPEAKER_P, normalizeForRegex } from "@franki/core";
import type { SlowParse } from "../intents/slow-parse";

const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;
const RX6 = REGEX_TABLE.find((r) => r.id === "RX6")!.pattern;
const RX7 = REGEX_TABLE.find((r) => r.id === "RX7")!.pattern;

export interface ArrivalFacts {
  text: string;
  cls: "U" | "T" | "M" | "O" | "C" | string;
  transcriptState: "final" | "missing" | "failed";
  supersedes: boolean;
}

/** The turn is one the route may run on at all. */
export const routeEligible = (f: ArrivalFacts): boolean => f.transcriptState === "final" && f.cls === "U" && !f.supersedes && f.text !== "";

/** RX4 matched the final transcript. */
export const regexOpens = (f: ArrivalFacts): boolean => routeEligible(f) && RX4.test(normalizeForRegex(f.text));

/** The open question of `core/rules`, when it was asked in this Session. */
export function askedHere(rules: CoreRules, sessionId: string): Extract<CoreRules["ask"]["q"], { kind: "asked" }> | null {
  const ask = rules.ask;
  if (ask === undefined || ask.sessionId !== sessionId || ask.q.kind !== "asked") return null;
  return ask.q;
}

/** A parse that opens hardRule: a committed parse whose hardRule probability is at the candidate threshold. */
export const candidateOpens = (slow: SlowParse | null): boolean => slow !== null && slow.parse.kind !== "failed" && (slow.probabilities?.hardRule ?? 0) >= CANDIDATE_P;

/**
 * G19: typed; or ASR with this turn's parse committed, `uncertainSpeaker` under `UNCERTAIN_SPEAKER_P` and no
 * `company` or `quiet` candidate.
 */
export function speakerCertain(source: "asr" | "typed", slow: SlowParse | null): boolean {
  if (source === "typed") return true;
  if (slow === null || slow.parse.kind === "failed" || slow.probabilities === null) return false;
  const p = slow.probabilities;
  return p.uncertainSpeaker < UNCERTAIN_SPEAKER_P && p.company < CANDIDATE_P && p.quiet < CANDIDATE_P;
}

/** Which of the correct and transition routes a trigger opened (design 3.0; brief 025 tasks C3 and D2). */
export interface MemoryRoutes {
  correct: boolean;
  transition: boolean;
}

/** At arrival: RX6 opens correct, RX7 opens transition, on the final transcript of a U turn. */
export function memoryRegexOpens(f: ArrivalFacts): MemoryRoutes {
  if (!routeEligible(f)) return { correct: false, transition: false };
  const t = normalizeForRegex(f.text);
  return { correct: RX6.test(t), transition: RX7.test(t) };
}

/** At the parse: a  or  candidate at  or more on a committed parse. */
export function memoryCandidates(slow: SlowParse | null): MemoryRoutes {
  const p = slow !== null && slow.parse.kind !== "failed" ? slow.probabilities : null;
  return { correct: (p?.correct ?? 0) >= CANDIDATE_P, transition: (p?.transition ?? 0) >= CANDIDATE_P };
}

export const anyMemoryRoute = (r: MemoryRoutes): boolean => r.correct || r.transition;
export const orRoutes = (a: MemoryRoutes, b: MemoryRoutes): MemoryRoutes => ({ correct: a.correct || b.correct, transition: a.transition || b.transition });
