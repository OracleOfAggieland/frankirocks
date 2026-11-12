/**
 * The `said` match (brief 023 task 7; contracts §6 "saidAt=admitted+(idTagged|exactTemplate|candidateAndReason),
 * else null; idTagged=metadata names noteId+transcript has its tokens; exactTemplate=normalized template;
 * candidateAndReason=candidate name+reason substring; read every message"). Pure. The server's `recordSaid` writes
 * the result with a ledger `delivery` row in one transaction: no ledger row, no claim.
 */
import type { Moment } from "../schema/records";

import type { SaidMatch } from "../gate/ledger";

/** One definition, the ledger's: the values of `SAID_MATCH` in the records schema. */
export type { SaidMatch };

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
 * `admitted`, or `delivered` by an earlier message of it), whose playback started, can be said, and only by a
 * transcript that matches.
 */
export function saidUpdate(m: Moment, r: SaidReceipt, t: SaidTarget, opsNow: number): { saidAt: number; saidMatch: Exclude<SaidMatch, "none"> } | null {
  if (m.status !== "admitted" && m.status !== "delivered") return null;
  if (m.admittedAt === null || m.responseId === null || m.responseId !== r.responseId) return null;
  // Brief 036 finding 14: the line must have started playing. A cancel before it ends the moment (`cancelled`),
  // so the status check above already refuses a line that was cut.
  if (m.playbackAt === null) return null;
  if (m.saidAt !== null) return null;
  const match = matchSaid(r, t);
  return match === "none" ? null : { saidAt: opsNow, saidMatch: match };
}

/**
 * The target a stored moment is matched against. Brief 036 finding 6: the line it was put on the wire as
 * (`rendered`), with that note's ID and tokens, when there is one; otherwise its code template.
 */
export function saidTargetOf(momentId: string, m: Moment): SaidTarget {
  if (m.rendered !== null) return { momentId, noteId: m.rendered.noteId, tokens: m.rendered.tokens, template: m.rendered.text, candidate: null };
  const template = m.payload.kind === "cue" ? (m.payload.template?.text ?? null) : null;
  return { momentId, noteId: null, tokens: m.cueTokens, template, candidate: null };
}

/** Up to eight tokens of a spoken line for an `idTagged` match: numbers first, then the longest words. */
export function saidTokens(line: string): string[] {
  const words = [...new Set(normalizeSaid(line).split(" ").filter((w) => w.length >= 3 || /\d/.test(w)))].map((w) => w.slice(0, 64));
  const digits = words.filter((w) => /\d/.test(w));
  const rest = words.filter((w) => !/\d/.test(w)).sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  return [...digits, ...rest].slice(0, 8);
}
