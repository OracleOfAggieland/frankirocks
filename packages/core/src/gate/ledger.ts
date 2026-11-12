/**
 * The Gate's ledger rows and their readers (brief 024; spec §6 "'Why did you bring that up?' reads the ledger, which
 * records said, held, steered, declined and blocked, as IDs and reason codes"; §3 "No row, no claim"). Pure.
 */
import type { Au, ID, Ref } from "../schema/primitives";
import { DecisionPayload, type Ledger, type PermitKind } from "../schema/records";
import type { Infer } from "../schema/v";
import type { DecisionIssuer, DecisionJudge, GateOutcome } from "./reasons";
import type { GateResult } from "./types";

export type GateRow = Extract<Ledger, { kind: "gate" }>;
export type GatePayload = GateRow["payload"];
export type SaidMatch = NonNullable<GatePayload["match"]>;

/** Reasons that mean the candidate was barred outright, not declined by policy. */
const BLOCKING: ReadonlySet<string> = new Set(["invalidInput", "ineligible", "rulesUnavailable"]);

/**
 * The row a Gate result writes now. `say` writes nothing yet: `said` is written from the transcript (spec §3 step 6).
 * A card or a use steers; a hold is held; a silent is blocked when barred outright, else declined.
 */
export function gateOutcome(r: GateResult): Exclude<GateOutcome, "said"> | null {
  switch (r.verdict) {
    case "say":
      return null;
    case "card":
      return "steered";
    case "hold":
      return "held";
    case "silent":
      if (r.form === "use") return "steered";
      return r.reasons.some((x) => BLOCKING.has(x)) ? "blocked" : "declined";
    default:
      r.verdict satisfies never;
      return null;
  }
}

export interface GateRowInput {
  candidateId: ID;
  refs: readonly Ref[];
  noteIds: readonly ID[];
  momentId: ID | null;
  sessionId: ID | null;
  turnId: ID | null;
  audience: Au;
  permitKind: PermitKind | null;
}

/** The payload for a Gate result's own row, or null for a `say` (which waits for the transcript). */
export function gateRowPayload(r: GateResult, at: GateRowInput): GatePayload | null {
  const outcome = gateOutcome(r);
  if (outcome === null) return null;
  return payload(outcome, r, at, null);
}

/** The `said` payload: a note matched in what was actually spoken, with the Gate result that approved it. */
export function saidRowPayload(r: GateResult, at: GateRowInput, match: SaidMatch): GatePayload | null {
  if (r.verdict !== "say" || match === "none") return null;
  return payload("said", r, at, match);
}

function payload(outcome: GateOutcome, r: GateResult, at: GateRowInput, match: SaidMatch | null): GatePayload {
  return {
    outcome,
    candidateId: at.candidateId,
    refs: at.refs.slice(0, 8),
    noteIds: at.noteIds.slice(0, 4),
    momentId: at.momentId,
    sessionId: at.sessionId,
    turnId: at.turnId,
    verdict: r.verdict,
    form: r.form,
    render: r.render,
    carveOut: r.carveOut,
    reasonCodes: [...new Set(r.reasons)].slice(0, 16),
    audience: at.audience,
    permitKind: at.permitKind,
    match,
  };
}

export interface WhyAnswer {
  entryId: ID;
  outcome: GateOutcome;
  reasonCodes: GatePayload["reasonCodes"];
  form: GatePayload["form"];
  carveOut: GatePayload["carveOut"];
  refs: Ref[];
}

function names(p: GatePayload, id: string): boolean {
  return p.candidateId === id || p.momentId === id || p.noteIds.includes(id) || p.refs.some((r) => r.id === id);
}

/**
 * "Why did you bring that up?": the newest `said` row naming the ID (note, moment, candidate or ref), with its
 * reasons and form. No row, no answer: null.
 */
export function whyBroughtUp(id: string, rows: readonly { id: ID; entry: Ledger }[]): WhyAnswer | null {
  return answerFrom(id, rows, ["said"]);
}

/** The same reader over any outcomes, for "Why didn't you…" (held, steered, declined, blocked). */
export function answerFrom(id: string, rows: readonly { id: ID; entry: Ledger }[], outcomes: readonly GateOutcome[]): WhyAnswer | null {
  if (typeof id !== "string" || id === "" || !Array.isArray(rows)) return null;
  let best: { id: ID; row: GateRow } | null = null;
  for (const r of rows) {
    const e = r?.entry;
    if (e === undefined || e === null || e.kind !== "gate" || e.state !== "complete") continue;
    if (!outcomes.includes(e.payload.outcome) || !names(e.payload, id)) continue;
    if (best === null || e.at > best.row.at || (e.at === best.row.at && r.id > best.id)) best = { id: r.id, row: e };
  }
  if (best === null) return null;
  const p = best.row.payload;
  return { entryId: best.id, outcome: p.outcome, reasonCodes: [...p.reasonCodes], form: p.form, carveOut: p.carveOut, refs: [...p.refs] };
}

// ---------------------------------------------------------------------------------------------
// Decision fields (questions 16, 17, 57): the defaults read for decisions written before them.

export type DecisionFields = Infer<typeof DecisionPayload> & {
  issuer: DecisionIssuer | null;
  permitKind: PermitKind | null;
  judge: DecisionJudge | null;
  falseHold: boolean | null;
};

/** A stored decision payload of either shape, with the admission fields filled (null when not recorded). */
export function decisionFields(p: Infer<typeof DecisionPayload>): DecisionFields {
  const q = p as Partial<DecisionFields>;
  return { ...p, issuer: q.issuer ?? null, permitKind: q.permitKind ?? null, judge: q.judge ?? null, falseHold: q.falseHold ?? null };
}
