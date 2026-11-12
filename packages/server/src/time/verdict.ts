/**
 * The one reread of a moment's source (brief 036 findings 1, 2 and 10; contracts "Commit checks
 * epoch/policy/source/lease/generation/eligibility"). The tick at open, `chooseNow`, the render in `proactiveOf` and
 * `admitMoment` all call `momentVerdict`, so each says the same thing about the same row:
 *
 *   ok         the source still stands, eligible, unheld, and the moment was planned from its current revision;
 *   stale      the source changed since the moment was planned (a new revision, or a move derive hasn't merged yet):
 *              nothing may be said from it, and the tick leaves it for derive to re-plan;
 *   gone       the source was corrected, retracted, superseded, closed, held or is ineligible;
 *   forgotten  the source is blocked.
 */
import {
  type Block,
  type ClockPort,
  type CoreDocs,
  type Effect,
  type Evidence,
  type Ledger,
  type Memory,
  type Moment,
  type Snapshot,
  type SourceVerdict,
  docRef,
  eligible,
  msFromTs,
  parseDep,
  sourceVerdict,
  withMomentDefaults,
} from "@franki/core";
import { ownerClock } from "../core-docs";
import { foregroundEC } from "../head-build";
import { paths } from "../store/paths";
import type { Reader, StoredDoc } from "../store/port";

/** Blocks and effects reread at open (contracts Snapshot `blocks` cap). */
const REREAD_MAX = 100;
/** Hold effects that stop a moment about their target or subject. */
const HOLDING_EFFECTS: readonly Effect["kind"][] = ["quiet", "careHold", "celebrationHold"];

export type MomentVerdict = SourceVerdict | "stale";

type Core = { [K in keyof CoreDocs]: { data: CoreDocs[K]; rev: number } };

export interface VerdictOptions {
  /** The hero rollup's detector passes now; null when the caller can't run it (inside a receipt's transaction). */
  rollupLive: boolean | null;
}

/** A Memory source reread: its row, its dependencies, the blocks and the hold effects. */
async function memoryVerdict(r: Reader, uid: string, moment: Moment, memoryId: string, core: Core, clock: ClockPort): Promise<MomentVerdict> {
  // A moved occasion speaks for its newest row; the moment's note names it, with the revision it was planned from.
  const noteRef = moment.payload.kind === "cue" && moment.payload.noteRef.type === "memory" ? moment.payload.noteRef : null;
  const noteId = noteRef?.id ?? memoryId;
  const current = (await r.get<Memory>(paths.memory(uid, noteId)))?.data ?? null;
  const plain = sourceVerdict(current);
  if (plain !== "ok" || current === null) return plain;
  if (noteRef !== null && noteRef.rev !== current.rev) return "stale";
  return rowVerdict(r, uid, moment, current, noteId, [memoryId, noteId], core, clock);
}

/** `eligible` and the hold effects over one current Memory row. */
async function rowVerdict(r: Reader, uid: string, moment: Moment, current: Memory, rowId: string, targets: readonly string[], core: Core, clock: ClockPort): Promise<MomentVerdict> {
  // Every dependency must be in the snapshot, or eligible denies the row.
  const deps: { ref: ReturnType<typeof docRef>; row: Evidence | Memory }[] = [];
  for (const dep of current.dependsOn) {
    const parsed = parseDep(dep);
    if (parsed === null) return "gone";
    if (parsed.collection === "evidence") {
      const e = await r.get<Evidence>(paths.evidence(uid, parsed.id));
      if (e !== null) deps.push({ ref: docRef("evidence", e.id, e.data.rev), row: e.data });
    } else {
      const d = await r.get<Memory>(paths.memory(uid, parsed.id));
      if (d !== null) deps.push({ ref: docRef("memories", d.id, d.data.rev), row: d.data });
    }
  }
  const blocks = await r.query<Block>({ collection: paths.collection(uid, "blocks"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: REREAD_MAX });
  const pair = ownerClock(core.state.data, clock);
  // An expiry ask is about a row whose bound has passed: read it as it stood just before.
  const world = moment.kind === "expiryAsk" && current.validTo !== null ? Math.min(pair.worldClock.now, msFromTs(current.validTo) - 1) : pair.worldClock.now;
  const ec = { ...foregroundEC(uid, core.epoch.data, { ...pair, worldClock: { ...pair.worldClock, now: world } }, 0), stage: "read" as const, purpose: "proactive" as const };
  const snapshot: Snapshot = {
    uid,
    epoch: core.epoch.data,
    session: null,
    job: null,
    localGeneration: 0,
    refs: [docRef("memories", rowId, current.rev), ...deps.map((d) => d.ref)],
    rows: [current, ...deps.map((d) => d.row)],
    blocks: blocks.map((b) => b.data),
    coverage: core.state.data.coverage,
    complete: blocks.length < REREAD_MAX,
  };
  const er = eligible({ ref: docRef("memories", rowId, current.rev), row: current }, ec, snapshot);
  if (!er.allow) return er.reason === "blocked" ? "forgotten" : "gone";
  // Q25 has no declared index here; the first page by ID, filtered in code. A full page fails closed.
  const effectPage = await r.query<Effect>({ collection: paths.collection(uid, "effects"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: REREAD_MAX });
  if (effectPage.length >= REREAD_MAX) return "gone";
  const effects = effectPage.filter((e) => e.data.state === "active");
  const subjects = new Set(moment.subjectIds.filter((s) => s !== "self"));
  const held = effects.some(
    (e) => HOLDING_EFFECTS.includes(e.data.kind) && (targets.includes(e.data.target.id) || (e.data.scope.subjectId !== null && subjects.has(e.data.scope.subjectId))),
  );
  return held ? "gone" : "ok";
}

/** A stored moment by path, read with its defaults (brief 036: `rendered`), or null. */
export async function getMoment(r: Reader, path: string): Promise<StoredDoc<Moment> | null> {
  const doc = await r.get<Moment>(path);
  return doc === null ? null : { ...doc, data: withMomentDefaults(doc.data) };
}

/** What a reread says about `moment`'s source now. `r` is a transaction when the caller writes on the answer. */
export async function momentVerdict(r: Reader, uid: string, moment: Moment, core: Core, clock: ClockPort, opts: VerdictOptions): Promise<MomentVerdict> {
  if (moment.memoryId !== null) return memoryVerdict(r, uid, moment, moment.memoryId, core, clock);
  if (moment.rollupId !== null) return opts.rollupLive === false ? "gone" : "ok";
  if (moment.actionId !== null) {
    const action = await r.get<Ledger>(paths.ledger(uid, moment.actionId));
    return action !== null && action.data.kind === "action" && action.data.state === "complete" ? "ok" : "gone";
  }
  return "gone";
}

/**
 * The note ID a moment travels as on the wire, bound to the lease it was put out under (brief 036 finding 1). A
 * re-plan, a new lease or a new generation changes it, so a permit issued before no longer admits.
 */
export const momentNoteId = (hasher: { id(parts: unknown): string }, momentId: string, m: Pick<Moment, "generation" | "leaseToken">): string =>
  hasher.id(["momentNote", momentId, m.generation, m.leaseToken]);
