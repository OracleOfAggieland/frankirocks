/**
 * Pure parts of admission (R17.7, R17.8; contracts §6 Permit, Hash, PermitTTL; design "Admission seam").
 * The server and the browser build the same canonical payload, so the browser can recompute
 * `approvedPayloadHash` and re-check the Permit at unmute. Hashing is injected (`Hasher.sha256`).
 */
import { type Hasher, canonicalBytes } from "./ids";
import type { Head, Ref } from "./schema/primitives";
import type { PermitKind } from "./schema/records";
import type { SafeTurn, Stamp, W } from "./schema/wire";

export const PERMIT_TTL_MS = 10_000;
/** The only line a `recoveryOnly` Permit covers. */
export const RECOVERY_LINE = "Sorry, say that again?";

export type AdmissionTurn =
  | { kind: "voice"; transcriptState: "final" | "missing" | "failed" }
  | { kind: "typed"; cls: "U" | "T" }
  | { kind: "tool" };

export interface PermitShape {
  kind: PermitKind;
  scope: "reply";
}

/**
 * devPermitKind (design table):
 *   voice, transcript final     slowOrdinary (deviation: contracts §6 needs judge O for audio; F2 restores it)
 *   voice, missing or failed    recoveryOnly
 *   typed U                     slowOrdinary
 *   typed T (pasted)            postCommitControl, no S1+ notes
 *   tool continuation           slowOrdinary
 */
export function devPermitKind(turn: AdmissionTurn): PermitShape {
  switch (turn.kind) {
    case "voice":
      return { kind: turn.transcriptState === "final" ? "slowOrdinary" : "recoveryOnly", scope: "reply" };
    case "typed":
      return { kind: turn.cls === "U" ? "slowOrdinary" : "postCommitControl", scope: "reply" };
    case "tool":
      return { kind: "slowOrdinary", scope: "reply" };
  }
}

export interface PayloadInput {
  stamp: Stamp;
  head: Head | null;
  notes: readonly W[];
  turns: readonly SafeTurn[];
  audioIds: readonly string[];
  toolOutput: unknown;
}

/** The canonical payload hashed into `approvedPayloadHash` (contracts §6 Hash). */
export function admissionPayload(p: PayloadInput) {
  return {
    stamp: p.stamp,
    head: p.head,
    notes: [...p.notes],
    turns: [...p.turns],
    audioIds: [...p.audioIds],
    toolOutput: p.toolOutput ?? null,
    candidates: [],
    attendees: [],
  };
}

/** SHA-256 hex of canonicalJSON(admissionPayload(p)). */
export function payloadHash(p: PayloadInput, hasher: Pick<Hasher, "sha256">): string {
  return hasher.sha256(canonicalBytes(admissionPayload(p)));
}

/** The Ref of a user Turn, for admission ledger payloads. */
export function turnRef(turnId: string, sessionId: string, rev: number): Ref {
  return { type: "turn", id: turnId, parentId: sessionId, rev };
}
