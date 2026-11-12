/**
 * The Admission_Seam (R17.1, R17.10; KV02, KV03; voice-control R8, R9, R13; design "The Admission_Seam"). Every
 * server Permit comes from `admitRule`, which runs the Server_Rule and writes exactly one ledger `decision` entry
 * in the caller's transaction before returning:
 *   Permit  keyed by permitId, state "complete", acceptedRefs [turn, request entry]
 *   hold    keyed by H("hold", stamp, requestId), state "blocked", acceptedRefs [request entry], heldRefs [turn]
 *   fastO   keyed by H("fastO", sessionId, turnId), from the browser's `admitted` receipt (`recordFastO`)
 * The closed `decision` payload has no issuer or Permit kind field (contract questions 16, 17, 57): the debug
 * route takes the kind from the cited request entry's stored response, and `fastO` from the decision's key.
 */
import {
  type Au,
  type Hasher,
  type ID,
  type Ledger,
  PERMIT_TTL_MS,
  type PayloadInput,
  type Permit,
  type ReasonCode,
  type Ref,
  type RuleInput,
  type RuleOutcome,
  type Stamp,
  type Turn,
  type TurnWrite,
  type W,
  ackNote,
  admittedNotes,
  idParts,
  payloadHash,
  serverRule,
  tsFromMs,
  writeRule,
} from "@franki/core";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";

// ---------------------------------------------------------------------------------------------
// The admission rule (voice-control R8, R9, R13; design "The Admission_Seam", question 57).

export interface RuleSeamInput extends PayloadInput {
  uid: string;
  requestId: string;
  /** The `/api/turn` (or `/api/tool`) request entry, whose stored response holds the Permit kind (question 57). */
  requestEntryId: string | null;
  turnRef: Ref;
  core: { epoch: number; policyRev: number };
  opsNow: number;
  rule: RuleInput;
  /** What this turn's on-turn route committed (brief 012 design section 4); none when absent. */
  write?: TurnWrite;
  /** The route's one S0 pointer note, or null (design 2.7). */
  routeNote?: W | null;
}

export type RuleSeamResult =
  | { kind: "permit"; permit: Permit; notes: W[]; outcome: Extract<RuleOutcome, { kind: "permit" }> }
  | { kind: "hold"; outcome: Extract<RuleOutcome, { kind: "hold" }> };

/**
 * Runs `serverRule`, builds the Permit when it grants one (with its Fixed_Line as an `ack` note), and writes exactly
 * one ledger `decision` in the caller's transaction. Runs in production too (R8.2). The decision cites the request
 * entry, whose stored response carries the Permit kind and status (question 57).
 */
export function admitRule(tx: Tx, input: RuleSeamInput, deps: { hasher: Hasher }): RuleSeamResult {
  // The Server_Rule, then the on-turn write's cut (G1): `writeRule` changes only the cut and the permit kind.
  const outcome = writeRule(input.rule, serverRule(input.rule), input.write ?? { kind: "none" });
  const now = tsFromMs(input.opsNow);
  const requestRef: Ref[] = input.requestEntryId === null ? [] : [{ type: "ledger", id: input.requestEntryId as ID, rev: 1 }];
  const decision = (state: "complete" | "blocked", id: string, accepted: Ref[], held: Ref[], reasons: ReasonCode[]) => {
    const entry: Extract<Ledger, { kind: "decision" }> = {
      ...cFields(input.uid, now, input.core.epoch, input.core.policyRev),
      kind: "decision",
      state,
      at: now,
      retainUntil: null,
      payload: { purpose: "answer", acceptedRefs: accepted.slice(0, 8), heldRefs: held, reasonCodes: [...new Set(reasons)].slice(0, 32), audience: input.rule.audience },
    };
    tx.create(paths.ledger(input.uid, id), entry);
  };
  if (outcome.kind === "hold") {
    decision("blocked", deps.hasher.id(["hold", input.stamp, input.requestId]), requestRef, [input.turnRef], outcome.reasons);
    return { kind: "hold", outcome };
  }
  const expiresAt = tsFromMs(input.opsNow + PERMIT_TTL_MS);
  const ack = outcome.line !== null ? ackNote(outcome.line, deps.hasher.id(["ack", input.stamp, outcome.line]) as ID, expiresAt) : null;
  const notes = admittedNotes(input.notes, outcome.notes, ack, input.routeNote ?? null);
  const payload: PayloadInput = { ...input, notes };
  const approvedPayloadHash = payloadHash(payload, deps.hasher);
  const permit: Permit = {
    permitId: deps.hasher.id(idParts.permit(input.stamp, outcome.permit, approvedPayloadHash)),
    stamp: input.stamp,
    kind: outcome.permit,
    scope: outcome.scope,
    approvedPayloadHash,
    noteIds: notes.map((n) => n.noteId).slice(0, 4),
    momentIds: [],
    expiresAt,
  };
  decision("complete", permit.permitId, [input.turnRef, ...requestRef], [], outcome.reasons);
  return { kind: "permit", permit, notes, outcome };
}

/** The ledger ID of a Turn's browser-issued fastO decision. */
export const fastODecisionId = (hasher: Hasher, sessionId: string, turnId: string): string => hasher.id(["fastO", sessionId, turnId]);

/**
 * Records a browser-issued `fastO` from its `admitted` receipt (R9.1, R9.2): one decision, keyed by the Turn, and
 * the Turn's `judge:"O"` and `admittedAt` when the Turn exists. `/api/turn` writes the same
 * Turn fields when it finds the decision first, so either order gives the same records. Creates no Permit.
 */
export async function recordFastO(
  tx: Tx,
  input: { uid: string; stamp: Stamp; responseId: string; opsNow: number; core: { epoch: number; policyRev: number }; audience: Au },
  deps: { hasher: Hasher },
): Promise<void> {
  const id = fastODecisionId(deps.hasher, input.stamp.sessionId, input.stamp.turnId);
  const path = paths.ledger(input.uid, id);
  const turnPath = paths.turn(input.uid, input.stamp.sessionId, input.stamp.turnId as ID);
  const [existing, turn] = [await tx.get(path), await tx.get<Turn>(turnPath)];
  if (existing !== null) return;
  const now = tsFromMs(input.opsNow);
  const ref: Ref = { type: "turn", id: input.stamp.turnId as ID, parentId: input.stamp.sessionId as ID, rev: 1 };
  const entry: Extract<Ledger, { kind: "decision" }> = {
    ...cFields(input.uid, now, input.core.epoch, input.core.policyRev),
    kind: "decision",
    state: "complete",
    at: now,
    retainUntil: null,
    payload: { purpose: "answer", acceptedRefs: [ref], heldRefs: [], reasonCodes: ["ok"], audience: input.audience },
  };
  tx.create(path, entry);
  if (turn !== null) tx.update(turnPath, { ...turn.data, ...fastOTurnFields(input.opsNow), updatedAt: now });
}

/**
 * The Turn fields a fastO admission sets, from the decision's time, so receipt-first and turn-first give the same
 * Turn. The response ID is not among them: the closed decision payload can't carry it for the turn-first order.
 */
export const fastOTurnFields = (opsNow: number) => ({ judge: "O" as const, admittedAt: tsFromMs(opsNow) });

/** The ledger ID of a late control hit's held decision. */
export const lateHitDecisionId = (hasher: Hasher, sessionId: string, turnId: string): string => hasher.id(["repair", sessionId, turnId]);

/**
 * A late control hit (a Parse_Repair that found one): nothing is admitted, so one `blocked` decision holds the Turn,
 * with the Effective_Audience at commit (design "The Parse_Repair"; review of wave A, item 22). `reasonCodes` has no
 * late-hit code, so it says `time`.
 */
export function recordLateHit(
  tx: Tx,
  input: { uid: string; sessionId: string; turnId: string; core: { epoch: number; policyRev: number }; opsNow: number; audience: Au },
  deps: { hasher: Hasher },
): void {
  const now = tsFromMs(input.opsNow);
  const entry: Extract<Ledger, { kind: "decision" }> = {
    ...cFields(input.uid, now, input.core.epoch, input.core.policyRev),
    kind: "decision",
    state: "blocked",
    at: now,
    retainUntil: null,
    payload: { purpose: "answer", acceptedRefs: [], heldRefs: [{ type: "turn", id: input.turnId as ID, parentId: input.sessionId as ID, rev: 1 }], reasonCodes: ["time"], audience: input.audience },
  };
  tx.create(paths.ledger(input.uid, lateHitDecisionId(deps.hasher, input.sessionId, input.turnId)), entry);
}
