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
import { ALONE_LINE, type AckText, COMPANY_LINE, RECOVERY_LINE } from "./voice/lines";
import type { TurnWrite } from "./writes/types";

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
      line: AckText | null;
      swap: "none" | "afterReply";
      /** This outcome stops a playing reply. */
      cut: boolean;
      reasons: ReasonCode[];
      /** Brief 048 ruling 3: row 11 chose forget; the route fences in the turn's own transaction. */
      forget?: true;
    }
  | {
      kind: "hold";
      reasons: ReasonCode[];
      /** The route answers `blocked`: this call is being closed by narrowing (wave B), or by a forget (brief 048). */
      blocked: boolean;
      swap: "none" | "now";
      /** Brief 048 ruling 3: row 11 chose forget; the route fences in the turn's own transaction. */
      forget?: true;
    };

const permit = (p: PermitKind, scope: "reply" | "ack", notes: NotesAllowed, cut: boolean, extra: { line?: AckText; swap?: "afterReply"; reasons?: ReasonCode[] } = {}): RuleOutcome => ({
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
    // Brief 035 (finding 3): with company or quiet too, the audience is recorded (R14.7) and the typed reply is S0.
    const careNarrows = i.wave === "B" && narrows;
    if (crisis) return permit("postCommitControl", "ack", i.source === "typed" && !i.callLive ? (careNarrows ? "S0" : typedPrivate) : "none", true, careNarrows ? { reasons: ["audience", ...quietReason] } : {});
    // Brief 035 (finding 4): a company or quiet candidate that fires narrows whatever was chosen, forget included.
    if (i.wave === "B" && narrows) {
      const reasons: ReasonCode[] = fires("company") ? ["audience"] : ["audience", "quiet"];
      // 8. Narrow with a live call: hang up and swap (R14.1).
      if (i.callLive) return hold(reasons, true, "now");
      // 9. Narrow with no call: the company line (typed).
      return permit("postCommitControl", "ack", "none", true, { line: COMPANY_LINE, reasons });
    }
    // 10. Alone (R15.1).
    if (i.wave === "B" && p.chosen === "alone" && fires("alone")) return permit("postCommitControl", "ack", "none", true, { line: ALONE_LINE, reasons: ["audience"] });
    // 11. Forget (brief 048 ruling 3). The speculative reply is cancelled and never resumed, and nothing is said on a
    // call opened before the fence: with a call live it hangs up and swaps as a company hit does (row 8), and only
    // the fresh call acknowledges. With none, the typed answer carries no line until the receipt's `blockedAt` is
    // set (ruling 8): the route adds the acknowledgment then, or the state route returns it once it is ready.
    if (p.chosen === "forget" && fires("forget")) return i.callLive ? { ...hold(["blocked"], true, "now"), forget: true } : { ...permit("postCommitControl", "ack", "none", true), forget: true };
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

// Brief 035 (findings 1, 2, 4): whether a parsed hit narrows the audience, for the routes that run the rule late
// (the Parse_Repair, the Superseding_Post) and for the rule's own rows 8 and 9.
type FiringParse = Pick<Extract<RuleParse, { kind: "hit" }>, "candidates" | "candidateP">;
const firesIn = (p: FiringParse, c: ControlClass, judge: RuleInput["judge"]) => p.candidates.includes(c) && routeFires(c, p.candidateP[c] ?? 0, judge);

/** A company or quiet candidate that fires narrows, whatever class was chosen (finding 4, as a retained crisis always gets care). */
export const narrowsAudience = (p: FiringParse, judge: RuleInput["judge"]): boolean => firesIn(p, "company", judge) || firesIn(p, "quiet", judge);

/** A retained crisis candidate fires (crisis is exempt from the judge; `routeFires`). */
export const crisisFires = (p: FiringParse, judge: RuleInput["judge"]): boolean => firesIn(p, "crisis", judge);

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

// ---------------------------------------------------------------------------------------------
// The on-turn write and the seam's notes (brief 012 design section 4, G1, G27, G30). Wave B, task B4.

/**
 * The cut and the permit kind after this turn's on-turn write (G1). A committed write that raised the Deck, or a
 * kept write with `cut` (a denial of an active rule), stops a playing reply: `cut` becomes true, and a
 * `slowOrdinary` or `postCommitControl` reply permit with no Fixed_Line becomes `postCommitControl`, so the reply is
 * created from the new Head. A hold, no write, or a write that raised nothing leaves `serverRule`'s outcome as it is.
 * `notes`, `scope`, `line` and `swap` never change (P10).
 */
export function writeRule(_i: RuleInput, base: RuleOutcome, w: TurnWrite): RuleOutcome {
  if (base.kind === "hold") return base;
  const raises = (w.kind === "committed" && w.deckRaised) || (w.kind === "kept" && w.cut);
  if (!raises) return base;
  const upgrade = (base.permit === "slowOrdinary" || base.permit === "postCommitControl") && base.scope === "reply" && base.line === null;
  return { ...base, permit: upgrade ? "postCommitControl" : base.permit, cut: true };
}

/** The notes a level lets through. */
export const notesAllowed = (notes: readonly W[], allowed: NotesAllowed): W[] => (allowed === "all" ? [...notes] : allowed === "S0" ? notes.filter((n) => n.sens === "S0") : []);

/** At most this many notes ride on one reply (contracts §6 Permit `noteIds`). */
export const NOTES_MAX = 4;

/**
 * The notes a Permit admits (design section 4): a Fixed_Line's ack note alone (no route note rides on a Fixed_Line,
 * G27); else the allowed notes, cut to three first when a route note comes too, so the route note is never the one
 * the bound drops (G30). The route note passes the same level as every other note.
 */
export function admittedNotes(candidates: readonly W[], allowed: NotesAllowed, ack: W | null, routeNote: W | null): W[] {
  if (ack !== null) return [ack];
  const own = notesAllowed(candidates, allowed);
  if (routeNote === null) return own.slice(0, NOTES_MAX);
  const route = notesAllowed([routeNote], allowed);
  return [...own.slice(0, NOTES_MAX - route.length), ...route];
}
