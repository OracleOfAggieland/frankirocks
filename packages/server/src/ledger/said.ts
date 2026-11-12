/**
 * The Gate's ledger writers (brief 024; spec §6 "Why did you bring that up?"; §3 step 6 "`said` is written from
 * what was actually spoken"). One `gate` entry per decision the Gate made and per note matched in speech, as IDs
 * and reason codes, never words.
 *
 * IDs are deterministic, so a retried route writes each row once:
 *   - a held, steered, declined or blocked row: `H("gate", uid, outcome, scope, candidateId)`, where `scope` is the
 *     user Turn the decision was made for, or the moment for a proactive one;
 *   - a said row: `H("gate", uid, "said", assistantTurnId, noteId)`, so the "why" route reads it with one get from
 *     the assistant Turn's `noteIds`.
 */
import {
  type GatePayload,
  type GateResult,
  type GateRowInput,
  type Hasher,
  type ID,
  type Ledger,
  type SaidMatch,
  type SaidReceipt,
  type TS,
  type W,
  type WhyAnswer,
  Ledger as LedgerSchema,
  gateRowPayload,
  matchSaid,
  saidRowPayload,
  saidTokens,
  validate,
  whyBroughtUp,
} from "@franki/core";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { Reader, Tx } from "../store/port";

type GateEntry = Extract<Ledger, { kind: "gate" }>;

export interface GateWriteAt {
  uid: string;
  now: TS;
  epoch: number;
  policyRev: number;
}

export function gateRowId(hasher: Hasher, uid: string, p: Pick<GatePayload, "outcome" | "candidateId" | "turnId" | "momentId" | "noteIds">): ID {
  if (p.outcome === "said") return hasher.id(["gate", uid, "said", p.turnId ?? "none", p.noteIds[0] ?? p.candidateId]);
  return hasher.id(["gate", uid, p.outcome, p.turnId ?? p.momentId ?? "none", p.candidateId]);
}

function entryOf(p: GatePayload, at: GateWriteAt): GateEntry {
  return { ...cFields(at.uid, at.now, at.epoch, at.policyRev), kind: "gate", state: "complete", at: at.now, retainUntil: null, payload: p };
}

/** Writes one row inside the caller's transaction, unless it is already stored. Returns the entry ID; throws on a row with no scope or one that fails validation. */
async function writeOnce(tx: Tx, hasher: Hasher, at: GateWriteAt, p: GatePayload): Promise<ID | null> {
  // Brief 033 finding 11: a row without a scope would collide with the same candidate's later row of the same
  // outcome, and a row that fails validation is a bug, not a quiet skip.
  if (p.turnId === null && p.momentId === null) throw new Error("gate row needs a turnId or a momentId");
  const entry = entryOf(p, at);
  if (!validate(LedgerSchema, entry).ok) throw new Error("gate row failed validation");
  const id = gateRowId(hasher, at.uid, p);
  const path = paths.ledger(at.uid, id);
  if ((await tx.get(path)) !== null) return id;
  tx.create(path, entry);
  return id;
}

/** The row for a Gate result that was not said: held, steered, declined or blocked. A `say` writes nothing here. */
export async function writeGateDecision(tx: Tx, hasher: Hasher, at: GateWriteAt, r: GateResult, row: GateRowInput): Promise<ID | null> {
  const p = gateRowPayload(r, row);
  return p === null ? null : writeOnce(tx, hasher, at, p);
}

/** What was heard for one note: the transcript receipt, and the note as it went on the wire. */
export interface Heard {
  receipt: SaidReceipt;
  note: Pick<W, "noteId" | "text" | "momentId">;
}

/**
 * The match for one note in what was heard (brief 033 finding 12): computed here with the time lane's matcher, never
 * taken from the caller. `idTagged` needs the receipt to name the note and the transcript to hold the line's tokens;
 * `exactTemplate` needs the note's line, normalized, in the transcript.
 */
export function noteMatch(h: Heard): SaidMatch {
  if (h.receipt.kind !== "transcript") return "none";
  return matchSaid(h.receipt, { momentId: h.note.momentId ?? "", noteId: h.note.noteId, tokens: saidTokens(h.note.text), template: h.note.text, candidate: null });
}

/**
 * The `said` row for one note matched in the assistant transcript. `row.turnId` is the assistant Turn and
 * `row.noteIds[0]` the note, which must be the note heard. The match is computed from what was heard. No match, no
 * row. The Gate result is still the caller's: no stored result is read back here.
 */
export async function writeSaid(tx: Tx, hasher: Hasher, at: GateWriteAt, r: GateResult, row: GateRowInput, heard: Heard): Promise<ID | null> {
  if (row.turnId === null || row.noteIds.length !== 1 || row.noteIds[0] !== heard.note.noteId) return null;
  const p = saidRowPayload(r, row, noteMatch(heard));
  return p === null ? null : writeOnce(tx, hasher, at, p);
}

/** "Why did you bring that up?" for one note of an assistant Turn: from its said row, or null with none. */
export async function readWhySaid(reader: Reader, hasher: Hasher, uid: string, assistantTurnId: ID, noteId: ID): Promise<WhyAnswer | null> {
  const id = hasher.id(["gate", uid, "said", assistantTurnId, noteId]);
  const doc = await reader.get<Ledger>(paths.ledger(uid, id));
  if (doc === null) return null;
  return whyBroughtUp(noteId, [{ id, entry: doc.data }]);
}
