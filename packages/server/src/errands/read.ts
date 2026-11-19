/**
 * Owner, Nov 19: `read_errand_result`, the tool a live call uses when the owner asks whether a look-up came back. One
 * call from `/api/tool`, inside its admission transaction, once the Server_Rule granted a Permit. Before it, a
 * finished result could only be said proactively at a pause, so "Did you get anything back?" had no way to it.
 *
 *   1. This Session's Errands by its mark (`errandMarks/{sessionId}`), as the state poll reads them: not dropped, of
 *      the current epoch, every connector still connected on the same account generation.
 *   2. The results: a waiting one (ready or failed) inside `ERRAND_RESULT_TTL_MS`, or a delivered or card-only one
 *      inside `ERRAND_CARD_KEEP_MS`, newest first, at most `ERRAND_READ_MAX`. Each is gated and worded exactly as a
 *      delivery is (`gateErrandLines`, `errandWords`) for the audience now. Without the Server_Rule's "all" (a gap,
 *      an uncertain speaker, an audience other than private), a result above S0 is the held line.
 *   3. A waiting result said in full here is `delivered`, so the proactive offer never repeats it; the Gate rows of
 *      its lines not said are written, as a delivery writes them. A held one stays waiting.
 *   4. A look-up still running adds the running note; with nothing at all, one S0 line says nothing came back.
 *
 * In crisis an Errand says nothing (review fix V7): the read answers the held line only, and moves nothing.
 */
import {
  type CoreEpoch,
  type CoreState,
  ERRAND_CARD_KEEP_MS,
  ERRAND_HELD_LINE,
  ERRAND_NONE_READ_LINE,
  ERRAND_RESULT_TTL_MS,
  ERRAND_RUN_SPAN_MS,
  type Connector,
  type Errand,
  type ErrandAbout,
  type ErrandMark,
  type ID,
  type Infer,
  type Session,
  type ToolResult,
  type W,
  errandRunningNote,
  errandWaiting,
  msFromTs,
  nextErrandStatus,
  tsFromMs,
} from "@franki/core";
import { gateAudience } from "../audience";
import { ownerClock } from "../core-docs";
import { writeGateDecision } from "../ledger/said";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import type { StoredDoc, Tx } from "../store/port";
import { errandWords } from "./deliver";
import { gateErrandLines } from "./gate";

type ReadErrandResult = Extract<Infer<typeof ToolResult>, { name: "read_errand_result" }>;

/** At most this many results one read returns (the wire holds three notes: two results and the running note). */
export const ERRAND_READ_MAX = 2;
/** How long a read's notes live on the wire. */
export const ERRAND_READ_NOTE_TTL_MS = 60_000;

export interface ErrandReadInput {
  session: Session;
  stamp: { sessionId: string; turnId: string };
  callId: string;
  core: { state: { data: CoreState }; epoch: { data: CoreEpoch } };
  /** The Server_Rule let every note out ("all"); otherwise only S0 words go. */
  full: boolean;
}

const fresh = (e: Errand, ops: number): boolean => {
  if (e.readyAt === null) return false;
  const ready = msFromTs(e.readyAt);
  if (errandWaiting(e.status)) return ready + ERRAND_RESULT_TTL_MS > ops;
  return (e.status === "delivered" || e.status === "cardOnly") && ready + ERRAND_CARD_KEEP_MS > ops;
};

async function readable(tx: Tx, uid: string, e: Errand): Promise<boolean> {
  const docs = await Promise.all(e.connectors.map((c) => tx.get<Connector>(paths.connector(uid, c.id))));
  return e.connectors.every((c, i) => {
    const d = docs[i]?.data ?? null;
    return d !== null && d.state === "connected" && d.activeGeneration === c.generation;
  });
}

/** This Session's Errands named by its mark, of the current epoch and not dropped, newest first. */
async function sessionErrands(tx: Tx, uid: string, sessionId: string, epoch: number, ops: number): Promise<StoredDoc<Errand>[]> {
  const mark = (await tx.get<ErrandMark>(paths.errandMark(uid, sessionId)))?.data ?? null;
  if (mark === null || msFromTs(mark.openUntil) <= ops) return [];
  const rows = await Promise.all(mark.errandIds.map((id) => tx.get<Errand>(paths.errand(uid, id))));
  return rows
    .filter((r): r is StoredDoc<Errand> => r !== null && r.data.sessionId === sessionId && r.data.status !== "dropped" && r.data.claimedEpoch === epoch)
    .sort((a, b) => msFromTs(b.data.startedAt) - msFromTs(a.data.startedAt));
}

/** The tool's answer, with this read's writes already made in `tx`. */
export async function readErrandResult(tx: Tx, ctx: RouteContext, x: ErrandReadInput): Promise<ReadErrandResult> {
  const { uid, deps } = ctx;
  const ops = deps.clock.read().opsClock.now;
  const epoch = x.core.epoch.data;
  const noteOf = (key: string, text: string, sens: W["sens"], dependsOn: string[] = []): W => ({
    noteId: deps.hasher.id(["errandRead", x.stamp.sessionId, x.stamp.turnId, x.callId, key]) as ID,
    rev: 1,
    kind: "result",
    text,
    rootKeys: [],
    dependsOn: dependsOn.slice(0, 256),
    sens,
    expiresAt: tsFromMs(ops + ERRAND_READ_NOTE_TTL_MS),
    unprompted: false,
    momentId: null,
    tokens: [],
  });
  const rows = await sessionErrands(tx, uid, x.stamp.sessionId, epoch.epoch, ops);
  const running = new Set<ErrandAbout>();
  for (const r of rows) if (r.data.status === "running" && ops - msFromTs(r.data.startedAt) <= ERRAND_RUN_SPAN_MS) for (const a of r.data.about) running.add(a);
  const done: StoredDoc<Errand>[] = [];
  for (const r of rows.filter((r) => fresh(r.data, ops)).sort((a, b) => msFromTs(b.data.readyAt!) - msFromTs(a.data.readyAt!))) {
    if (done.length >= ERRAND_READ_MAX) break;
    if (await readable(tx, uid, r.data)) done.push(r);
  }
  const runningNote = running.size === 0 ? [] : [noteOf("running", errandRunningNote([...running]), "S0")];
  if (done.length === 0) {
    return running.size === 0
      ? { name: "read_errand_result", state: "none", notes: [noteOf("none", ERRAND_NONE_READ_LINE, "S0")] }
      : { name: "read_errand_result", state: "running", notes: runningNote };
  }

  const { audience, modifiers } = gateAudience(x.session, ops);
  if (modifiers.crisis) return { name: "read_errand_result", state: "found", notes: [noteOf("held", ERRAND_HELD_LINE, "S0")] };
  const clock = ownerClock(x.core.state.data, deps.clock).worldClock;
  const at = { uid, now: tsFromMs(ops), epoch: epoch.epoch, policyRev: epoch.policyRev };
  const notes: W[] = [];
  for (const r of done) {
    const id = r.id as ID;
    const e = r.data;
    const verdicts = gateErrandLines({ errand: e, inputs: e.gate, audience, modifiers, worldNow: clock.now, zone: clock.zone, candidateId: (i) => deps.hasher.id(["errandLine", id, i]) as ID });
    const words = errandWords(e, verdicts, audience);
    // The Server_Rule's S0 limit holds here as for every tool output: words above S0 become the held line.
    if (!x.full && words.sens !== "S0") {
      notes.push(noteOf(id, ERRAND_HELD_LINE, "S0"));
      continue;
    }
    const evidence = [...new Set(words.said.flatMap((v) => v.line.refs.map((ref) => e.reads.find((rd) => rd.ref === ref)).filter((rd) => rd !== undefined).map((rd) => `e:${rd!.evidenceId}`)))];
    const note = noteOf(id, words.text, words.sens, evidence);
    notes.push(note);
    if (words.text === ERRAND_HELD_LINE) continue;
    for (const v of verdicts) {
      if (v.shown === "say") continue;
      const refs = v.line.refs.map((ref) => e.reads.find((rd) => rd.ref === ref)).filter((rd) => rd !== undefined).slice(0, 8).map((rd) => ({ type: "evidence" as const, id: rd!.evidenceId, rev: rd!.rev }));
      await writeGateDecision(tx, deps.hasher, at, v.result, { candidateId: v.candidateId, refs, noteIds: [note.noteId], momentId: null, sessionId: x.stamp.sessionId as ID, turnId: x.stamp.turnId as ID, audience, permitKind: null });
    }
    // Said here, so the proactive offer never repeats it (the card still shows it).
    const next = errandWaiting(e.status) ? nextErrandStatus(e.status, "delivered") : null;
    if (next !== null) tx.update(r.path, { ...e, status: next, endedAt: at.now, updatedAt: at.now } satisfies Errand);
  }
  return { name: "read_errand_result", state: "found", notes: [...notes, ...runningNote].slice(0, 3) };
}
