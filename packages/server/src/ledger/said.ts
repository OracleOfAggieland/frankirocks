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
  type TS,
  type WhyAnswer,
  Ledger as LedgerSchema,
  gateRowPayload,
  saidRowPayload,
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

/** Writes one row inside the caller's transaction, unless it is already stored. Returns the entry ID, or null. */
async function writeOnce(tx: Tx, hasher: Hasher, at: GateWriteAt, p: GatePayload): Promise<ID | null> {
  const entry = entryOf(p, at);
  if (!validate(LedgerSchema, entry).ok) return null;
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

/**
 * The `said` row for one note matched in the assistant transcript. `row.turnId` is the assistant Turn and
 * `row.noteIds[0]` the note. No match, no row.
 */
export async function writeSaid(tx: Tx, hasher: Hasher, at: GateWriteAt, r: GateResult, row: GateRowInput, match: SaidMatch): Promise<ID | null> {
  if (row.turnId === null || row.noteIds.length !== 1) return null;
  const p = saidRowPayload(r, row, match);
  return p === null ? null : writeOnce(tx, hasher, at, p);
}

/** "Why did you bring that up?" for one note of an assistant Turn: from its said row, or null with none. */
export async function readWhySaid(reader: Reader, hasher: Hasher, uid: string, assistantTurnId: ID, noteId: ID): Promise<WhyAnswer | null> {
  const id = hasher.id(["gate", uid, "said", assistantTurnId, noteId]);
  const doc = await reader.get<Ledger>(paths.ledger(uid, id));
  if (doc === null) return null;
  return whyBroughtUp(noteId, [{ id, entry: doc.data }]);
}
