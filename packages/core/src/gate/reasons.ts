/**
 * The Gate's closed vocabularies (brief 024; spec §6; contracts §2 Policy). Constants only, so the stored ledger
 * schema can name them without importing the Gate.
 */

/** Most open first. */
export const GATE_VERDICTS = ["say", "card", "hold", "silent"] as const;
export type GateVerdict = (typeof GATE_VERDICTS)[number];

/** Spec §6 "Forms". */
export const GATE_FORMS = ["item", "checkIn", "door", "use"] as const;
export type GateForm = (typeof GATE_FORMS)[number];

/** How a `say` is rendered: free words, attributed to its sender, one offer, hedged, or a code template. */
export const GATE_RENDERS = ["free", "attributed", "offer", "hedged", "template"] as const;
export type GateRender = (typeof GATE_RENDERS)[number];
/**
 * Renders from the freest to the most bound (brief 033 property 5): free words; hedged and offer, still the model's
 * words; attributed, by sender and type; template, typed code slots only. A narrower context never moves left.
 */
export const GATE_RENDER_FREEDOM = ["free", "hedged", "offer", "attributed", "template"] as const satisfies readonly GateRender[];

/** Spec §3 line 120 (logged enabled carve-outs) and the +200 code forms of the `proactive` row. */
export const GATE_CARVE_OUTS = ["openedTopicRecall", "jarTap", "checkIn", "door", "oLogistics", "authorization"] as const;
export type GateCarveOut = (typeof GATE_CARVE_OUTS)[number];

/** Spec §6 "Floors": the cases that bypass the caps. */
export const MUST_SAY_KINDS = ["hardRuleConflict", "commitmentDue", "criticalLogistics"] as const;
export type MustSayKind = (typeof MUST_SAY_KINDS)[number];

export const GATE_REASONS = [
  "ok",
  "invalidInput",
  "ineligible",
  "rulesUnavailable",
  "useOnly",
  "quiet",
  "notAsked",
  "asked",
  "topicOpen",
  "ceiling",
  "sensitivity",
  "carveOut",
  "authorization",
  "audience",
  "doorsOff",
  "rushed",
  "crisis",
  "quietHours",
  "cap",
  "heavyCap",
  "senderCap",
  "afterCheckIn",
  "transition",
  "mustSay",
  "mustSayUnproven",
] as const;
export type GateReason = (typeof GATE_REASONS)[number];

/** Spec §6 "Why did you bring that up?": what the ledger records. */
export const GATE_OUTCOMES = ["said", "held", "steered", "declined", "blocked"] as const;
export type GateOutcome = (typeof GATE_OUTCOMES)[number];

/** Who issued an admission decision (first-spoken-call question 16). */
export const DECISION_ISSUERS = ["fastORule", "admissionSeam", "devAdmit"] as const;
export type DecisionIssuer = (typeof DECISION_ISSUERS)[number];

/** The judge's answer as a Turn records it (voice-control question 57). */
export const DECISION_JUDGES = ["O", "H", "U", "timeout", "error", "typed"] as const;
export type DecisionJudge = (typeof DECISION_JUDGES)[number];
