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
