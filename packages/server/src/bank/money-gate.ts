/**
 * Brief 046 part C: the Gate in front of a money read, called from `gateToolOutput` (routes/gate-tool.ts) and from
 * the typed path's finisher, inside the admission transaction.
 *
 * Each note above S0 is one candidate for the pure `gate()`: the owner's own bank rows (class O, sensitivity S1, the
 * same as `evidenceClass` gives a bank row), on the `recall` trigger, with no topic and `MONEY_ALIASES` as its
 * aliases, so "asked" is the pure gate's own `askedByOwner`: the owner's certain U or C words this turn hold one of
 * those terms. A note goes out only when the Gate answers `say` with the `free` render: private and asked. Anything
 * else writes its Gate row in `tx` and the note is replaced by one S0 line with no digit (`MONEY_LINES.held`). No
 * path goes around the Gate, and nothing is relabelled to pass.
 */
import {
  type GateCandidate,
  type GateContext,
  type GateResult,
  type ID,
  type Ref,
  type Session,
  type Turn,
  type W,
  MONEY_ALIASES,
  MONEY_LINES,
  gate,
  parseDep,
  tsFromMs,
} from "@franki/core";
import { gateAudience } from "../audience";
import { ownerSpeakerCertain } from "../company-off";
import type { Env } from "../config/env";
import { writeGateDecision } from "../ledger/said";
import type { Tx } from "../store/port";
import type { RouteContext } from "../routes/runtime";
import type { MoneyResult } from "./money-read";

/** A Gate row carries at most this many refs (the ledger's `refs` cap); the note itself carries the full lineage. */
const GATE_REFS_MAX = 8;

export interface MoneyGateInput {
  session: Session;
  turn: Turn;
  sessionId: ID;
  turnId: ID;
  worldNow: number;
  zone: string;
  opsNow: number;
  epoch: number;
  policyRev: number;
}

/** The Gate candidate for one money note. */
export function moneyCandidate(note: W): GateCandidate {
  return {
    id: note.noteId,
    kind: "memory",
    subjectId: "self",
    sourceClass: "O",
    sens: note.sens,
    allergy: false,
    // Every row behind the note passed `eligible()` at stage toolReturn when it was read.
    eligibility: { allow: true, reason: "ok" },
    toldAt: null,
    topic: null,
    queryTerms: [],
    aliases: [...MONEY_ALIASES],
    purpose: "item",
    gravity: 0,
    food: false,
    mustSay: null,
    dueAt: null,
    sender: null,
    attestedPremises: 0,
    offerUsed: false,
    ownRooted: false,
    checkInUsed: false,
    act: "say",
  };
}

export function moneyGateContext(x: MoneyGateInput, audience: GateContext["audience"], modifiers: GateContext["modifiers"], notesThisReply: number, env: Env): GateContext {
  // As for a recall: the owner's words count only when the speaker is certain (a typed line, or a judge O; owner,
  // Nov 19: with company mode off, the owner's own final voice line too, company-off.ts).
  const certain = x.turn.sourceClass === "U" || x.turn.sourceClass === "C" ? ownerSpeakerCertain(x.turn, env) : false;
  return {
    worldNow: tsFromMs(x.worldNow),
    zone: x.zone,
    build: "floor",
    audience,
    modifiers,
    trigger: "recall",
    moment: null,
    ownerTurn: { text: x.turn.text ?? "", sourceClass: x.turn.sourceClass, certain },
    openedTopics: [],
    recentTurns: [],
    counts: { proactive: 0, heavy: 0, senderAsks: 0, notesThisReply },
    rules: "ready",
    authorization: null,
  };
}

/** The money result the Gate lets out; every note it does not let out has its row written in `tx`. */
export async function gateMoneyResult(tx: Tx, ctx: RouteContext, x: MoneyGateInput, result: MoneyResult): Promise<MoneyResult> {
  if (result.notes.every((n) => n.sens === "S0")) return result;
  const { audience, modifiers } = gateAudience(x.session, x.opsNow);
  const at = { uid: ctx.uid, now: tsFromMs(x.opsNow), epoch: x.epoch, policyRev: x.policyRev };
  const kept: W[] = [];
  let held = false;
  for (const note of result.notes) {
    if (note.sens === "S0") {
      kept.push(note);
      continue;
    }
    const c = moneyCandidate(note);
    const r = gate(c, moneyGateContext(x, audience, modifiers, kept.length, ctx.deps.env));
    if (r.verdict === "say" && r.render === "free") {
      kept.push(note);
      continue;
    }
    held = true;
    // A `say` with another render (an unknown audience gives S1 the template) is not said either: a money note has no
    // template, so it is held, and its row records the hold (a `say` would write no row). The Gate's own reasons stay.
    const row: GateResult = r.verdict === "say" ? { ...r, verdict: "hold", form: null, render: null, carveOut: null, reasons: [...r.reasons.filter((x) => x !== "ok"), audience === "private" ? "ceiling" : "audience"] } : r;
    const refs: Ref[] = note.dependsOn
      .map(parseDep)
      .filter((d) => d !== null && d.collection === "evidence")
      .slice(0, GATE_REFS_MAX)
      .map((d) => ({ type: "evidence", id: d!.id as ID, rev: 1 }));
    await writeGateDecision(tx, ctx.deps.hasher, at, row, { candidateId: c.id, refs, noteIds: [note.noteId], momentId: null, sessionId: x.sessionId, turnId: x.turnId, audience, permitKind: null });
  }
  if (!held) return { ...result, notes: kept };
  // Nothing with an amount goes out: the whole answer is held, and one line with no digit says so.
  const first = result.notes[0]!;
  const line: W = { ...first, noteId: ctx.deps.hasher.id(["money-held", x.sessionId, x.turnId]) as ID, text: MONEY_LINES.held, rootKeys: [], dependsOn: [], sens: "S0" };
  return { ...result, state: "held", notes: [line], cards: [] };
}
