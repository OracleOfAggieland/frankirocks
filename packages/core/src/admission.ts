/**
 * Pure parts of admission (R17.7, R17.8; contracts §6 Permit, Hash, PermitTTL; design "Admission seam").
 * The server and the browser build the same canonical payload, so the browser can recompute
 * `approvedPayloadHash` and re-check the Permit at unmute. Hashing is injected (`Hasher.sha256`).
 */
import { type Hasher, canonicalBytes } from "./ids";
import type { ControlClass } from "./intents/classes";
import type { ParseOutcome } from "./intents/parse";
import { routeFires } from "./intents/route";
import type { Au, Head, ReasonCode, Ref } from "./schema/primitives";
import type { PermitKind } from "./schema/records";
import type { SafeTurn, Stamp, W } from "./schema/wire";
import { ALONE_LINE, COMPANY_LINE, FORGET_NOT_YET, type FixedLine, RECOVERY_LINE } from "./voice/lines";

export const PERMIT_TTL_MS = 10_000;
/** The only line a `recoveryOnly` Permit covers; it lives with every Fixed_Line in `voice/lines.ts`. */
export { RECOVERY_LINE } from "./voice/lines";

// ---------------------------------------------------------------------------------------------
// The Server_Rule (voice-control R8, R10.2, R12, R14, R15; design "The Server_Rule"). Pure and total: every input
// gives exactly one outcome. It reads no clock, and no input compares the server clock with a browser time (R8.7).

export type RuleParse = ParseOutcome | { kind: "failed"; why: "deadline" | "transport" | "invalid" | "oversize" } | { kind: "none" };

export interface RuleInput {
  source: "asr" | "typed" | "pasted" | "tool";
  transcript: "final" | "missing" | "failed";
  judge: "O" | "H" | "U" | "timeout" | "error" | "typed";
  parse: RuleParse;
  /** A Regex_Table hit; it decides only when the parse failed (R10.2). */
  regexMatch: boolean;
  /** The Effective_Audience: `unknown` while a repair is pending. */
  audience: Au;
  /** This Session narrowed during itself (wave B): its call is being closed. */
  narrowedHere: boolean;
  /** The Session has a registered call. */
  callLive: boolean;
  parseGap: boolean;
  /** The most sensitive note the reply would carry. */
  noteSens: "none" | "S0" | "S1+";
  /** At least one ASR word per 2 s of audio. Typed text substitutes for audio. */
  wordsPer2s: boolean;
  /** Every item `final:true`. */
  allFinal: boolean;
  /** For a tool continuation: the Turn's parse has committed. */
  toolParseCommitted: boolean;
  wave: "A" | "B";
}

export type NotesAllowed = "none" | "S0" | "all";

export type RuleOutcome =
  | {
      kind: "permit";
      permit: PermitKind;
      /** `ack`: the browser creates the reply with no tools (question 88). */
      scope: "reply" | "ack";
      notes: NotesAllowed;
      line: FixedLine | null;
      swap: "none" | "afterReply";
      /** This outcome stops a playing reply. */
      cut: boolean;
      reasons: ReasonCode[];
    }
  | {
      kind: "hold";
      reasons: ReasonCode[];
      /** The route answers `blocked`: this call is being closed by narrowing (wave B). */
      blocked: boolean;
      swap: "none" | "now";
    };

const permit = (p: PermitKind, scope: "reply" | "ack", notes: NotesAllowed, cut: boolean, extra: { line?: FixedLine; swap?: "afterReply"; reasons?: ReasonCode[] } = {}): RuleOutcome => ({
  kind: "permit",
  permit: p,
  scope,
  notes,
  line: extra.line ?? null,
  swap: extra.swap ?? "none",
  cut,
  reasons: extra.reasons ?? [],
});
const hold = (reasons: ReasonCode[], blocked = false, swap: "none" | "now" = "none"): RuleOutcome => ({ kind: "hold", reasons, blocked, swap });

const failReasons = (why: "deadline" | "transport" | "invalid" | "oversize" | "none"): ReasonCode[] =>
  why === "deadline" || why === "transport" ? ["DEPENDENCY"] : why === "invalid" ? ["invalidInput"] : why === "oversize" ? ["oversize"] : ["missingDependency"];

/** Design rows 1 to 13, checked in order; the first that matches decides. */
export function serverRule(i: RuleInput): RuleOutcome {
  // 1. A call closed by narrowing speaks no more (R14.5).
  if (i.narrowedHere) return hold(["audience"], true);
  // 2. Pasted T text: no parse, postCommitControl, never an S1+ note (R8.10).
  if (i.source === "pasted") return i.noteSens === "S1+" ? hold(["sensitivity"]) : permit("postCommitControl", "reply", "S0", false);
  // 3. A tool continuation, once the Turn's parse has committed (R8.11, R12.7). All notes only on a judge-O (or
  // typed) turn in a private audience with no gap (R8.12; property 8).
  if (i.source === "tool") return i.toolParseCommitted ? permit("slowOrdinary", "reply", (i.judge === "O" || i.judge === "typed") && i.audience === "private" && !i.parseGap ? "all" : "S0", false) : hold(["missingDependency"]);
  // 4. No transcript: the neutral line; a playing reply finishes (R7.4, R7.6, R8.7).
  if (i.transcript !== "final") return permit("recoveryOnly", "reply", "none", false, { reasons: ["missingDependency"] });
  // 5. The parse failed: the regex decides whether a playing reply is cut (R10.2, R11.7).
  if (i.parse.kind === "failed" || i.parse.kind === "none") {
    const why = i.parse.kind === "failed" ? i.parse.why : "none";
    // A typed line with no call open has no spoken Neutral_Line: it is shown as text (review of wave A, item 17).
    const typedNoCall = i.source === "typed" && !i.callLive;
    return permit("recoveryOnly", "reply", "none", i.regexMatch, typedNoCall ? { line: RECOVERY_LINE, reasons: failReasons(why) } : { reasons: failReasons(why) });
  }
  const p = i.parse;
  if (p.kind === "hit") {
    // A typed line with no call open, in a private audience with no gap: no one else sees the typed reply, so a hit
    // with no Fixed_Line keeps it whatever its Sensitivity, as an ordinary parse would (review of wave A, item 24).
    const typedPrivate: NotesAllowed = i.source === "typed" && i.judge === "typed" && !i.callLive && i.audience === "private" && !i.parseGap ? "all" : "S0";
    // A route that changes what is said needs both nets, or one very sure net; crisis is exempt (routeFires; review of
    // the live run, item 5). A candidate that doesn't fire still gets the cheap protections of row 12.
    const fires = (c: ControlClass) => p.candidates.includes(c) && routeFires(c, p.candidateP[c] ?? 0, i.judge);
    const crisis = fires("crisis");
    const narrows = fires("company") || fires("quiet");
    const quietReason: ReasonCode[] = p.candidates.includes("quiet") ? ["quiet"] : [];
    // 6. Crisis with company or quiet: the care reply first, then the swap (R14.7; question 68).
    if (crisis && i.wave === "B" && narrows && i.callLive) return permit("postCommitControl", "ack", "none", true, { swap: "afterReply", reasons: ["audience", ...quietReason] });
    // 7. Crisis always takes the reply (R12.1). A typed line with no call open has no spoken care reply: its typed
    // reply, which the Head's crisis instruction governs, travels as an S0 note, still with scope ack (item 17).
    if (crisis) return permit("postCommitControl", "ack", i.source === "typed" && !i.callLive ? typedPrivate : "none", true);
    if (i.wave === "B" && (p.chosen === "company" || p.chosen === "quiet") && fires(p.chosen)) {
      const reasons: ReasonCode[] = p.chosen === "quiet" ? ["audience", "quiet"] : ["audience"];
      // 8. Narrow with a live call: hang up and swap (R14.1).
      if (i.callLive) return hold(reasons, true, "now");
      // 9. Narrow with no call: the company line (typed).
      return permit("postCommitControl", "ack", "none", true, { line: COMPANY_LINE, reasons });
    }
    // 10. Alone (R15.1).
    if (i.wave === "B" && p.chosen === "alone" && fires("alone")) return permit("postCommitControl", "ack", "none", true, { line: ALONE_LINE, reasons: ["audience"] });
    // 11. Forget before forget exists (R12.3).
    if (p.chosen === "forget" && fires("forget")) return permit("postCommitControl", "ack", "none", true, { line: FORGET_NOT_YET });
    // 12. Every other hit keeps its tools, no S1+ note except a typed line's own reply with no call open in a private
    // audience with no gap (R12.2, R12.5, R12.7; item 24). Its route doesn't change what is
    // said, so a reply already playing under fastO is not cut (design review of the build; question 92).
    return permit("postCommitControl", "reply", typedPrivate, false);
  }
  // 13. Ordinary: slowOrdinary; an S1+ note only with judge O, density, all final, no gap, private (R8.4, R8.5).
  // Typed text substitutes for audio and the judge (contracts §6), so a typed line skips the density checks.
  const typed = i.source === "typed";
  const full = (i.judge === "O" || i.judge === "typed") && (typed || (i.wordsPer2s && i.allFinal)) && !i.parseGap && i.audience === "private";
  return permit("slowOrdinary", "reply", full ? "all" : "S0", false);
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
