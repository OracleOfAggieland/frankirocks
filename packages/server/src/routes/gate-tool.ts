/**
 * The Gate in front of a tool result (brief 030 phase two, part A; brief 033 "The Gate's shape for the wiring lane").
 *
 * `/api/tool` makes one call here, inside its admission transaction, after the Server_Rule: each note a recall
 * answers with is put to the Gate, once per Memory (or, with none, per Evidence) it cites, on the `recall` trigger,
 * with this Session's audience and modifiers (`gateAudience`) and the owner's own words for the Turn. A note goes
 * out only when every candidate behind it is `say` with the `free` render; anything not said writes its Gate row
 * (`held`, `steered`, `declined` or `blocked`) in the same transaction, scoped to the Turn.
 *
 * Rulings, each fails closed and each listed in the brief's report:
 *   - `RECALL_ALIASES`: nothing builds a candidate's entity names yet (brief 033 ruling 1), so a Memory's aliases are
 *     the words of its own value when its class is U, C or O, and none otherwise. A recall is asked only when the
 *     owner's words hold one of them.
 *   - A `say` whose render is not `free` (template, attributed, sender) is dropped, since the note's text is the
 *     recall model's, not the template's. `buildGatedWhisper` for recall notes is not wired.
 *   - `GATE_S0_RECALL` (false): S0 notes pass as the Server_Rule lets them; notes above S0 go to the Gate.
 *   - `inspect` ("What do you know about me?") is not put to the Gate here: its lines are snapshot rows the owner
 *     asked for as a whole, already limited by the Server_Rule.
 */
import {
  type Au,
  type CoreDocs,
  type ToolResult,
  type Infer,
  type Evidence,
  type GateCandidate,
  type GateContext,
  type GateResult,
  type ID,
  type Memory,
  type Ref,
  type Sens,
  type Session,
  type Turn,
  type W,
  gate,
  parseDep,
  tokenize,
  tsFromMs,
} from "@franki/core";
import { gateAudience } from "../audience";
import { ownerClock } from "../core-docs";
import { readAllMemories } from "../head-build";
import { writeGateDecision } from "../ledger/said";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import type { RouteContext } from "./runtime";
// Brief 046 part C.
import { gateMoneyResult } from "../bank/money-gate";

/**
 * Ruling needed: the Gate silences every recall that isn't asked, S0 included, and asks need a certain speaker (a
 * typed turn, or judge `O`). The Server_Rule has always let S0 recall notes out on any turn, since S0 is safe for any
 * audience; this keeps that, so only notes above S0 are put to the Gate. Set true to gate S0 as well.
 */
export const GATE_S0_RECALL = false;

/** Where a recall candidate's aliases come from until entity names are built: the Memory's own words (U, C, O). */
export const RECALL_ALIASES = "ownValueWords" as const;
const ALIAS_CLASSES = new Set(["U", "C", "O"]);
const SENS_ORDER: readonly Sens[] = ["S0", "S1", "S2"];
const maxSens = (a: Sens, b: Sens): Sens => (SENS_ORDER.indexOf(a) >= SENS_ORDER.indexOf(b) ? a : b);

export interface ToolGateInput {
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

/** Lowest trust first: a row is as trusted as its least trusted slice. */
const CLASS_TRUST: readonly GateCandidate["sourceClass"][] = ["T", "M", "O", "C", "U"];

/**
 * Evidence carries no class. The owner's own calendar and bank rows are O; anything else (mail, a paste, a turn whose
 * speaker this read can't prove) is read as T, which only an asked recall raises (fails closed).
 *
 * Review D3: a row from a connector (a connected Google account, a bank) takes the lowest-trust class among its
 * slices, so a stranger's invite title (a T slice) is never said as the owner's own. A connector row with no slice
 * is T. Fixture rows (no connector) keep the source rule above.
 */
export function evidenceClass(e: Evidence): GateCandidate["sourceClass"] {
  if (e.connectorId !== null) {
    if (e.fieldSlices.length === 0) return "T";
    let lowest = CLASS_TRUST.length - 1;
    for (const s of e.fieldSlices) lowest = Math.min(lowest, Math.max(0, CLASS_TRUST.indexOf(s.class as GateCandidate["sourceClass"])));
    return CLASS_TRUST[lowest]!;
  }
  return e.source === "calendar" || e.source === "plaid" ? "O" : "T";
}

/**
 * The Gate candidates behind a note. A recall note carries its lines' lineage, not their Memory IDs, so the Memories
 * behind it are every active one whose own rootKeys and dependsOn all lie in the note's (a Memory sharing that lineage
 * is put to the Gate too, which fails closed). With none, its Evidence. Null when a dependency can't be read.
 */
async function candidatesOf(tx: Tx, uid: string, note: W, all: readonly { id: string; data: Memory }[]): Promise<{ c: GateCandidate; ref: Ref }[] | null> {
  const deps = note.dependsOn.map(parseDep);
  if (deps.some((d) => d === null)) return null;
  const roots = new Set(note.rootKeys);
  const depSet = new Set(note.dependsOn);
  const memories = all.filter((m) => m.data.status === "active" && m.data.dependsOn.length > 0 && m.data.rootKeys.every((k) => roots.has(k)) && m.data.dependsOn.every((d) => depSet.has(d)));
  const out: { c: GateCandidate; ref: Ref }[] = [];
  const base = { topic: null, queryTerms: [], purpose: "item", food: false, mustSay: null, dueAt: null, attestedPremises: 0, offerUsed: false, ownRooted: false, checkInUsed: false, act: "say" } as const;
  if (memories.length > 0) {
    for (const { id, data: row } of memories) {
      const text = row.value.kind === "text" ? row.value.text : "";
      out.push({
        ref: { type: "memory", id: id as ID, rev: row.rev },
        c: {
          ...base,
          id: id as ID,
          kind: "memory",
          subjectId: row.subjectId,
          sourceClass: row.sourceClass,
          sens: row.sens,
          allergy: row.predicate === "allergy",
          // The recall's lines were read through `eligible` at stage project; only an active Memory may be said.
          eligibility: { allow: row.status === "active", reason: row.status === "active" ? "ok" : "stale" },
          toldAt: row.sourceClass === "U" || row.sourceClass === "C" ? row.assertedAt : null,
          aliases: ALIAS_CLASSES.has(row.sourceClass) ? tokenize(text) : [],
          gravity: (row.gravity >= 3 ? 3 : row.gravity <= 0 ? 0 : Math.floor(row.gravity)) as 0 | 1 | 2 | 3,
          sender: row.sourceClass === "T" ? { mailedByOwner: false } : null,
        },
      });
    }
    return out;
  }
  for (const d of deps) {
    if (d!.collection !== "evidence") continue;
    const e = (await tx.get<Evidence>(paths.evidence(uid, d!.id)))?.data ?? null;
    if (e === null) return null;
    let sens: Sens = "S0";
    for (const s of e.fieldSlices) sens = maxSens(sens, s.sens);
    out.push({
      ref: { type: "evidence", id: d!.id as ID, rev: 1 },
      c: { ...base, id: d!.id as ID, kind: "memory", subjectId: "self", sourceClass: evidenceClass(e), sens, allergy: false, eligibility: { allow: true, reason: "ok" }, toldAt: null, aliases: [], gravity: 0, sender: evidenceClass(e) === "T" ? { mailedByOwner: false } : null },
    });
  }
  return out.length === 0 ? null : out;
}

function contextOf(x: ToolGateInput, audience: Au, modifiers: { rushed: boolean; crisis: boolean }, notesThisReply: number): GateContext {
  const certain = x.turn.sourceClass === "U" || x.turn.sourceClass === "C" ? x.turn.itemIds.length === 0 || x.turn.judge === "O" : false;
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

/** The notes the Gate lets out, in order; every other candidate's row is written in `tx`. */
export async function gateRecallNotes(tx: Tx, ctx: RouteContext, x: ToolGateInput, notes: readonly W[]): Promise<W[]> {
  const { audience, modifiers } = gateAudience(x.session, x.opsNow);
  const at = { uid: ctx.uid, now: tsFromMs(x.opsNow), epoch: x.epoch, policyRev: x.policyRev };
  const kept: W[] = [];
  const all = (await readAllMemories(tx, ctx.uid)).map((m) => ({ id: m.id, data: m.memory }));
  for (const note of notes) {
    if (note.sens === "S0" && !GATE_S0_RECALL) {
      kept.push(note);
      continue;
    }
    const cands = await candidatesOf(tx, ctx.uid, note, all);
    if (cands === null) continue;
    let ok = true;
    for (const { c, ref } of cands) {
      const r: GateResult = gate(c, contextOf(x, audience, modifiers, kept.length));
      if (r.verdict === "say" && r.render === "free") continue;
      ok = false;
      await writeGateDecision(tx, ctx.deps.hasher, at, r, { candidateId: c.id, refs: [ref], noteIds: [note.noteId], momentId: null, sessionId: x.sessionId, turnId: x.turnId, audience, permitKind: null });
    }
    if (ok) kept.push(note);
  }
  return kept;
}

type Result = Infer<typeof ToolResult>;

/**
 * The tool route's one call: a recall's notes (other than `inspect`) through the Gate; any other result as it is.
 * `core` is what the route read in its transaction.
 */
export async function gateToolOutput(
  tx: Tx,
  ctx: RouteContext,
  x: { session: Session; turn: Turn; stamp: { sessionId: string; turnId: string }; core: { state: { data: CoreDocs["state"] }; epoch: { data: CoreDocs["epoch"] } }; purpose: string | null },
  output: Result,
): Promise<Result> {
  // Brief 046 part C: a money read's notes go to the Gate as the owner's own S1 bank rows (bank/money-gate.ts).
  const moneyAsked = output.name === "read_money";
  if (!moneyAsked && (output.name !== "recall" || x.purpose === null || x.purpose === "inspect" || output.notes.length === 0)) return output;
  const pair = ownerClock(x.core.state.data, ctx.deps.clock);
  const input: ToolGateInput = {
    session: x.session,
    turn: x.turn,
    sessionId: x.stamp.sessionId as ID,
    turnId: x.stamp.turnId as ID,
    worldNow: pair.worldClock.now,
    zone: pair.worldClock.zone,
    opsNow: pair.opsClock.now,
    epoch: x.core.epoch.data.epoch,
    policyRev: x.core.epoch.data.policyRev,
  };
  if (output.name === "read_money") return gateMoneyResult(tx, ctx, input, output);
  if (output.name !== "recall") return output;
  return { ...output, notes: await gateRecallNotes(tx, ctx, input, output.notes) };
}
