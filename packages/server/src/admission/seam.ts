/**
 * The Admission_Seam (R17.1, R17.4, R17.10; KV02, KV03; design "Admission seam"). `admit` is the only function
 * that creates a Permit. It calls the active implementation (`devAdmit` in this slice) and writes exactly one
 * ledger `decision` entry in the caller's transaction before returning:
 *   Permit  keyed by permitId, state "complete", acceptedRefs [turn]
 *   hold    keyed by H("hold", stamp, requestId), state "blocked", heldRefs [turn]
 * The closed `decision` payload has no issuer or Permit kind field (contract questions 16, 17): the debug route
 * reports issuer "devAdmit" and derives the kind from the stored Turn.
 */
import {
  type Au,
  type Hasher,
  type ID,
  type Ledger,
  type NotesAllowed,
  PERMIT_TTL_MS,
  type PayloadInput,
  type Permit,
  type ReasonCode,
  type Ref,
  type RuleInput,
  type RuleOutcome,
  type Stamp,
  type Turn,
  type W,
  ackNote,
  idParts,
  payloadHash,
  serverRule,
  tsFromMs,
} from "@franki/core";
import type { Env } from "../config/env";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { type AdmitInput, type AdmitResult, devAdmit } from "./dev-admit";

export interface SeamInput extends AdmitInput {
  uid: string;
  requestId: string;
  turnRef: Ref;
  core: { epoch: number; policyRev: number };
}

export function admit(tx: Tx, input: SeamInput, deps: { env: Env; hasher: Hasher }): AdmitResult {
  // devAdmit throws in production before anything is computed or written.
  const result = devAdmit(input, deps.env, deps.hasher);
  const now = tsFromMs(input.opsNow);
  const entryId = result.kind === "permit" ? result.permit.permitId : deps.hasher.id(["hold", input.stamp, input.requestId]);
  const entry: Extract<Ledger, { kind: "decision" }> = {
    ...cFields(input.uid, now, input.core.epoch, input.core.policyRev),
    kind: "decision",
    state: result.kind === "permit" ? "complete" : "blocked",
    at: now,
    retainUntil: null,
    payload: {
      purpose: "answer",
      acceptedRefs: result.kind === "permit" ? [input.turnRef] : [],
      heldRefs: result.kind === "permit" ? [] : [input.turnRef],
      reasonCodes: result.kind === "permit" ? [] : result.reasonCodes,
      audience: "private",
    },
  };
  tx.create(paths.ledger(input.uid, entryId), entry);
  return result;
}

// ---------------------------------------------------------------------------------------------
// The real admission rule (voice-control R8, R9, R13; design "The Admission_Seam", question 57).

export interface RuleSeamInput extends PayloadInput {
  uid: string;
  requestId: string;
  /** The `/api/turn` (or `/api/tool`) request entry, whose stored response holds the Permit kind (question 57). */
  requestEntryId: string | null;
  turnRef: Ref;
  core: { epoch: number; policyRev: number };
  opsNow: number;
  rule: RuleInput;
}

export type RuleSeamResult =
  | { kind: "permit"; permit: Permit; notes: W[]; outcome: Extract<RuleOutcome, { kind: "permit" }> }
  | { kind: "hold"; outcome: Extract<RuleOutcome, { kind: "hold" }> };

const notesAllowed = (notes: readonly W[], allowed: NotesAllowed): W[] => (allowed === "all" ? [...notes] : allowed === "S0" ? notes.filter((n) => n.sens === "S0") : []);

/**
 * Runs `serverRule`, builds the Permit when it grants one (with its Fixed_Line as an `ack` note), and writes exactly
 * one ledger `decision` in the caller's transaction. Runs in production too (R8.2). The decision cites the request
 * entry, whose stored response carries the Permit kind and status (question 57).
 */
export function admitRule(tx: Tx, input: RuleSeamInput, deps: { hasher: Hasher }): RuleSeamResult {
  const outcome = serverRule(input.rule);
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
  const notes = outcome.line !== null ? [ackNote(outcome.line, deps.hasher.id(["ack", input.stamp, outcome.line]) as ID, expiresAt)] : notesAllowed(input.notes, outcome.notes);
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
 * the Turn's `judge:"O"`, `admittedAt` and `spokenResponseId` when the Turn exists. `/api/turn` writes the same
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
  if (turn !== null) tx.update(turnPath, { ...turn.data, ...fastOTurnFields(input.opsNow, input.responseId), updatedAt: now });
}

/** The Turn fields a fastO admission sets. */
export const fastOTurnFields = (opsNow: number, responseId: string) => ({ judge: "O" as const, admittedAt: tsFromMs(opsNow), spokenResponseId: responseId });
