/**
 * When a route that changes what is said may fire (review of the live run, item 5; design question 95). Pure.
 *
 * A class at CANDIDATE_P (0.20) is a candidate, as contracts §5 says: enough for the cheap protections (no S1+ note on
 * the turn, the decision on the record). A route that cuts a reply, speaks a Fixed_Line or (wave B) hangs up needs
 * more: the judge's value is not `O` and the class is at 0.20 or more (both nets), or the class alone is at STRONG_P
 * (one very sure net). A typed line counts as its own judge (`typed`), so it fires at 0.20.
 *
 * Crisis is exempt: a retained crisis candidate takes the reply whatever the judge said.
 */
import { CANDIDATE_P, type ControlClass, STRONG_P } from "./classes";

export type JudgeValue = "O" | "H" | "U" | "timeout" | "error" | "typed";

export function routeFires(cls: ControlClass, p: number, judge: JudgeValue): boolean {
  if (p < CANDIDATE_P) return false;
  if (cls === "crisis") return true;
  return judge !== "O" || p >= STRONG_P;
}

/** The parse as the route rule reads it: the candidates and each one's probability. */
export interface RouteParse {
  chosen: ControlClass | null;
  candidates: readonly ControlClass[];
  candidateP: Partial<Record<ControlClass, number>>;
}

/**
 * Whether a hit's route changes what is said and fires: a retained crisis, `forget`, and in wave B `company`, `quiet`
 * and `alone` (question 92), each through `routeFires`. The Parse_Repair and the Superseding_Post read this to decide
 * whether a late hit raises policyRev, which cancels speech through the next Deck (KV05).
 */
export function changesWhatIsSaid(p: RouteParse, judge: JudgeValue, wave: "A" | "B"): boolean {
  const fires = (c: ControlClass) => p.candidates.includes(c) && routeFires(c, p.candidateP[c] ?? 0, judge);
  if (fires("crisis")) return true;
  if (p.chosen === null) return false;
  const routed: readonly ControlClass[] = wave === "B" ? ["forget", "company", "quiet", "alone"] : ["forget"];
  return routed.includes(p.chosen) && fires(p.chosen);
}