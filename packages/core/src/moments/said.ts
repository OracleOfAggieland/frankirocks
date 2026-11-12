/**
 * The `said` match (brief 023 task 7; contracts §6 "saidAt=admitted+(idTagged|exactTemplate|candidateAndReason),
 * else null; idTagged=metadata names noteId+transcript has its tokens; exactTemplate=normalized template;
 * candidateAndReason=candidate name+reason substring; read every message"). Pure. The server's `recordSaid` writes
 * the result with a ledger `delivery` row in one transaction: no ledger row, no claim.
 */
import type { Moment } from "../schema/records";

export type SaidMatch = "none" | "idTagged" | "exactTemplate" | "candidateAndReason";

export interface SaidReceipt {
  kind: "admitted" | "playbackStarted" | "playbackEnded" | "cancelled" | "transcript" | "pendingRendered";
  responseId: string;
  momentIds: readonly string[];
  noteIds: readonly string[];
  text: string | null;
}

export interface SaidTarget {
  momentId: string;
  /** The note the moment travelled as, when the receipt's metadata may name it instead of the moment. */
  noteId: string | null;
  /** Tokens an `idTagged` match needs, all of them, in the transcript. */
  tokens: readonly string[];
  /** The moment's code template. */
  template: string | null;
  /** A suggestion's candidate name and its code reason. */
  candidate: { name: string; reason: string } | null;
}

/** Lower case, NFKC, letters and digits only, single spaces. */
export function normalizeSaid(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const contains = (said: string, part: string): boolean => {
  const p = normalizeSaid(part);
  return p.length > 0 && ` ${said} `.includes(` ${p} `);
};

/** Which match a transcript makes for a moment, in the contract's order. */
export function matchSaid(r: SaidReceipt, t: SaidTarget): SaidMatch {
  if (r.kind !== "transcript" || r.text === null) return "none";
  const said = normalizeSaid(r.text);
  if (said.length === 0) return "none";
  const tagged = r.momentIds.includes(t.momentId) || (t.noteId !== null && r.noteIds.includes(t.noteId));
  if (tagged && t.tokens.length > 0 && t.tokens.every((tok) => contains(said, tok))) return "idTagged";
  if (t.template !== null && contains(said, t.template)) return "exactTemplate";
  if (t.candidate !== null && contains(said, t.candidate.name) && contains(said, t.candidate.reason)) return "candidateAndReason";
  return "none";
}

/**
 * `saidAt` and the match for a transcript receipt, or null. Only a moment admitted on this very response (status
 * `admitted`, or `delivered` by an earlier message of it) can be said, and only by a transcript that matches.
 */
export function saidUpdate(m: Moment, r: SaidReceipt, t: SaidTarget, opsNow: number): { saidAt: number; saidMatch: Exclude<SaidMatch, "none"> } | null {
  if (m.status !== "admitted" && m.status !== "delivered") return null;
  if (m.admittedAt === null || m.responseId === null || m.responseId !== r.responseId) return null;
  if (m.saidAt !== null) return null;
  const match = matchSaid(r, t);
  return match === "none" ? null : { saidAt: opsNow, saidMatch: match };
}

/** The target a stored moment is matched against: its ID, its template, and the template's words as tokens. */
export function saidTargetOf(momentId: string, m: Moment): SaidTarget {
  const template = m.payload.kind === "cue" ? (m.payload.template?.text ?? null) : null;
  return { momentId, noteId: null, tokens: m.cueTokens, template, candidate: null };
}
