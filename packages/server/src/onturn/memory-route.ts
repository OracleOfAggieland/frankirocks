/**
 * The correct and transition routes in the turn's transaction (brief 012 design 3.0 steps 2 to 5 and 7, 3.2, 3.3;
 * brief 025 tasks C3 and D2). It validates the FastSlots items of the routes a trigger opened, re-reads every target
 * with `tx.get` (still active or history, the same rev, the same predicate; otherwise the item defers), runs the
 * same-key query in the transaction (a row the snapshot didn't show defers the item, G36), and plans with the pure
 * planners (`applyCorrection`, `applyTransition`). It returns the Commands, the `handled` entries, the note kinds and
 * the rows the Head overlay needs; `writeMemoryCommands` writes the Commands in the same transaction.
 *
 * Nothing here says anything was corrected or changed: the note kinds are sent only after the transaction commits.
 */
import {
  type Command,
  type CorrectionVerdict,
  type FastSlotsOut,
  type HeadMemory,
  type Hasher,
  HANDLED_KEYS_MAX,
  HANDLED_REFS_MAX,
  type ID,
  type ItemVerdict,
  type Memory,
  type OnTurnHandled,
  type PlanEnv,
  type Ref,
  type Route,
  type RouteNoteKind,
  type Snapshot,
  type TransitionVerdict,
  type TurnEvidence,
  TRUTH_ORDER,
  applyCorrection,
  applyTransition,
  keyOf,
  maxSens,
  rootKey,
  tsFromMs,
  validateItems,
  verifyTurnSpan,
} from "@franki/core";
import { DAY_MS } from "../records";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { type OnTurnContext, type OnTurnTarget, entitiesFor } from "./context";

type Reader = Pick<Tx, "get" | "query">;

/**
 * Ruling for this build (brief 025, for the owner to confirm): a row the route writes from this turn's words is rooted
 * in the turn's U slice that holds the proof span, as the hardRule route roots a rule (its root keys are the
 * Evidence's own slice keys), not in a slice cut to the span. The proof's words are inside that slice, and the
 * value's words are checked against the span before anything is written (rows C7, R1).
 */
export const ROUTE_ROWS_ROOT_AT_TURN_SLICE = true;

/** A row rooted in a slice of this turn, moved to the turn's slice that covers it (`ROUTE_ROWS_ROOT_AT_TURN_SLICE`). */
function rootedAtTurnSlice(m: Memory, ev: TurnEvidence, hasher: Hasher): Memory {
  if (!ROUTE_ROWS_ROOT_AT_TURN_SLICE || m.rootSlices.length !== 1) return m;
  const r = m.rootSlices[0]!;
  if (r.eid !== ev.eid || r.start === null || r.end === null) return m;
  const cover = ev.slices.find((x) => x.fieldPath === r.fieldPath && x.start !== null && x.end !== null && x.start <= r.start! && r.end! <= x.end && x.class === r.class);
  if (cover === undefined) return m;
  return { ...m, rootSlices: [cover], rootKeys: [rootKey(cover, hasher)], sens: maxSens(m.sens, cover.sens) };
}

/** Same-key rows the transaction reads per key (extraction's bound). */
const SAME_KEY_LIMIT = 32;

export interface MemoryRouteInput {
  uid: string;
  routes: { correct: boolean; transition: boolean };
  out: FastSlotsOut;
  evidence: TurnEvidence;
  context: OnTurnContext;
  targets: ReadonlyMap<ID, OnTurnTarget>;
  speakerCertain: boolean;
  source: "asr" | "typed";
  worldNow: number;
  opsNow: number;
  epoch: number;
  policyRev: number;
  hasher: Hasher;
}

export interface MemoryOutcome {
  /** `putMemory` Commands only, in plan order. */
  commands: Extract<Command, { op: "putMemory" }>[];
  entries: OnTurnHandled[];
  kinds: RouteNoteKind[];
  /** Rows as they will be after the commit, for the Head overlay. */
  overlay: Memory[];
  /** A Memory was written. */
  changed: boolean;
  /** Only transition rows were written (G1's fastO case). */
  transitionOnly: boolean;
  /** A correction the owner said again: nothing written, kept, no cut. */
  same: boolean;
}

export const NO_MEMORY: MemoryOutcome = { commands: [], entries: [], kinds: [], overlay: [], changed: false, transitionOnly: false, same: false };

const memRef = (m: Memory): Ref => ({ type: "memory", id: m.logicalId, rev: m.rev });

async function readRow(tx: Reader, uid: string, id: ID): Promise<Memory | null> {
  return (await tx.get<Memory>(paths.memory(uid, id)))?.data ?? null;
}

/** Active rows on `key`, read in the transaction with no `validFromKey` bound (design 3.0 step 4). */
async function sameKeyRows(tx: Reader, uid: string, key: ID): Promise<Memory[]> {
  const docs = await tx.query<Memory>({
    collection: paths.collection(uid, "memories"),
    where: [
      { field: "key", op: "==", value: key },
      { field: "status", op: "==", value: "active" },
    ],
    orderBy: { field: "validFromKey", dir: "desc" },
    limit: SAME_KEY_LIMIT,
  });
  return docs.map((d) => d.data);
}

/** The keys a correction or rename writes on. A rename also writes the entity's `identity.name` key. */
function correctionKeys(v: CorrectionVerdict, targets: readonly Memory[], hasher: Hasher): ID[] {
  const keys = targets.map((t) => t.key);
  if (v.kind === "rename") keys.push(keyOf(v.entity, "identity.name", {}, { kind: "text", text: v.to }, hasher).key);
  return [...new Set(keys)];
}

/**
 * A deferred entry (brief 043, finding 8): never any keys or refs. A deferral is extraction's to apply, and a ref here
 * would keep `pickOpen` and `closable` from offering that row to extraction. `_read` names what the route read, for
 * the reader of this file only.
 */
const deferred = (route: Route, _read: Ref[]): OnTurnHandled => ({ route, outcome: "deferred", keys: [], refs: [], ruleKeys: [] });

export async function planMemoryRoutes(tx: Reader, a: MemoryRouteInput): Promise<MemoryOutcome> {
  const routes = new Set<Route>([...(a.routes.correct ? (["correct"] as const) : []), ...(a.routes.transition ? (["transition"] as const) : [])]);
  if (routes.size === 0) return NO_MEMORY;
  const ev = a.evidence;
  const verdicts: ItemVerdict[] = validateItems(a.out, {
    evidence: ev,
    source: a.source,
    speakerCertain: a.speakerCertain,
    routes,
    answering: null,
    known: a.context.known,
    entities: entitiesFor(a.context.known, ev.text),
    targets: a.targets,
    worldNow: a.worldNow,
    hasher: a.hasher,
  });
  const shown = new Set(a.context.memories.map((m) => m.id));
  const env = (index: number): PlanEnv | null => {
    const span = verifyTurnSpan(a.out.items[index]!.span, ev);
    if (span === null) return null;
    const contextIds: Ref[] = [...a.targets.values()].map((t) => memRef(t.memory)).slice(0, 32);
    return {
      uid: a.uid,
      evidence: ev,
      proof: span,
      lineage: { packetEids: [ev.eid], contextIds, dependsOn: [`e:${ev.eid}`, ...[...a.targets.values()].map((t) => `m:${t.memory.logicalId}@${t.rev}`)] },
      worldNow: tsFromMs(a.worldNow),
      opsNow: tsFromMs(a.opsNow),
      nextReviewAt: tsFromMs(a.worldNow + 365 * DAY_MS),
      epoch: a.epoch,
      policyRev: a.policyRev,
      hasher: a.hasher,
    };
  };

  const out: MemoryOutcome = { ...NO_MEMORY, commands: [], entries: [], kinds: [], overlay: [] };
  const written = new Map<ID, Memory>();
  let wroteCorrection = false;
  let wroteTransition = false;

  for (const v of verdicts) {
    if (v.kind === "correction") {
      const c = v.v;
      if (c.kind === "defer") {
        out.entries.push(deferred("correct", []));
        continue;
      }
      const ids = c.kind === "rename" ? [c.target] : c.targets;
      // Step 3: every target re-read in the transaction, unchanged since the snapshot.
      const rows = new Map<ID, Memory>();
      let moved = false;
      for (const id of ids) {
        const now = await readRow(tx, a.uid, id);
        const seen = a.targets.get(id);
        if (now === null || seen === undefined || now.rev !== seen.rev || (now.status !== "active" && now.status !== "history") || now.predicate !== seen.memory.predicate) moved = true;
        else rows.set(id, now);
      }
      const targetRefs = [...rows.values()].map(memRef);
      if (moved) {
        out.entries.push(deferred("correct", targetRefs));
        continue;
      }
      if (c.kind === "same") {
        out.entries.push({ route: "correct", outcome: "same", keys: [], refs: targetRefs.slice(0, HANDLED_REFS_MAX), ruleKeys: [] });
        out.same = true;
        continue;
      }
      // Step 4: the same-key rows, read in the transaction; one the snapshot didn't show defers (G36).
      const keys = correctionKeys(c, [...rows.values()], a.hasher);
      let unseen = false;
      for (const k of keys) {
        for (const m of await sameKeyRows(tx, a.uid, k)) {
          if (!shown.has(m.logicalId) && !written.has(m.logicalId)) unseen = true;
          if (!rows.has(m.logicalId)) rows.set(m.logicalId, written.get(m.logicalId) ?? m);
        }
      }
      // Wrong rows on the keys too, so `negated` sees them (G35).
      for (const m of a.context.memories) if (keys.includes(m.memory.key) && m.memory.status === "wrong" && !rows.has(m.id)) rows.set(m.id, m.memory);
      const e = env(v.index);
      if (unseen || e === null) {
        out.entries.push(deferred("correct", targetRefs));
        continue;
      }
      const plan = applyCorrection(c, rows, e);
      if (!plan.ok) {
        out.entries.push(deferred("correct", targetRefs));
        continue;
      }
      const puts = plan.commands.filter((x): x is Extract<Command, { op: "putMemory" }> => x.op === "putMemory");
      if (puts.length === 0) {
        out.entries.push({ route: "correct", outcome: "same", keys: [], refs: targetRefs.slice(0, HANDLED_REFS_MAX), ruleKeys: [] });
        out.same = true;
        continue;
      }
      // Brief 043: a second item whose writes land on a row this turn already wrote (the same correction twice) is
      // never written twice in one transaction; it is extraction's.
      if (puts.some((p) => written.has(p.id))) {
        out.entries.push(deferred("correct", []));
        continue;
      }
      for (const p0 of puts) {
        const p = p0.expectRev === null ? { ...p0, row: rootedAtTurnSlice(p0.row, ev, a.hasher) } : p0;
        out.commands.push(p);
        written.set(p.id, p.row);
      }
      wroteCorrection = true;
      const refs = [...new Map([...targetRefs, ...puts.map((p) => memRef(p.row))].map((r) => [r.id, r])).values()];
      // A retraction lists its target in `refs` but not its key, so extraction still writes a new value for it (5).
      const outcome = c.kind === "rename" ? "renamed" : c.kind === "retract" ? "retracted" : "applied";
      const entryKeys = c.kind === "retract" ? [] : [...new Set(puts.map((p) => p.row.key))];
      out.entries.push({ route: "correct", outcome, keys: entryKeys.slice(0, HANDLED_KEYS_MAX), refs: refs.slice(0, HANDLED_REFS_MAX), ruleKeys: [] });
      out.kinds.push(c.kind === "rename" ? "renamed" : c.kind === "retract" ? "retracted" : "corrected");
    } else if (v.kind === "transition") {
      const t: TransitionVerdict = v.v;
      if (t.kind === "careOnly") {
        out.entries.push({ route: "transition", outcome: "careOnly", keys: [], refs: [], ruleKeys: [] });
        continue;
      }
      if (t.kind === "defer") {
        out.entries.push(deferred("transition", []));
        continue;
      }
      // The subject's rows on the kind's truth-order predicates, re-read in the transaction.
      const rows = new Map<ID, Memory>();
      let moved = false;
      for (const [id, seen] of a.targets) {
        if (seen.memory.subjectId !== t.subject || !TRUTH_ORDER[t.transition].includes(seen.memory.predicate)) continue;
        const now = await readRow(tx, a.uid, id);
        if (now === null || now.rev !== seen.rev) moved = true;
        else rows.set(id, written.get(id) ?? now);
      }
      for (const m of a.context.memories) {
        if (m.memory.subjectId === t.subject && TRUTH_ORDER[t.transition].includes(m.memory.predicate) && m.memory.status === "wrong" && !rows.has(m.id)) rows.set(m.id, m.memory);
      }
      // `care` rows about the subject (death and recovery resolve them): `careSubjectRef` names the subject.
      for (const [id, seen] of a.targets) {
        if (seen.memory.predicate !== "care" || seen.memory.args.careSubjectRef !== t.subject || rows.has(id)) continue;
        const now = await readRow(tx, a.uid, id);
        if (now === null || now.rev !== seen.rev) moved = true;
        else rows.set(id, now);
      }
      const keys = new Set([...rows.values()].map((m) => m.key));
      let unseen = false;
      for (const k of keys) for (const m of await sameKeyRows(tx, a.uid, k)) if (!shown.has(m.logicalId) && !written.has(m.logicalId)) unseen = true;
      const e = env(v.index);
      if (moved || unseen || e === null) {
        out.entries.push(deferred("transition", [...rows.values()].map(memRef)));
        continue;
      }
      const plan = applyTransition(t, rows, e);
      const puts = plan.ok ? plan.commands.filter((x): x is Extract<Command, { op: "putMemory" }> => x.op === "putMemory") : [];
      if (!plan.ok) {
        out.entries.push(deferred("transition", [...rows.values()].map(memRef)));
        continue;
      }
      // Fail closed (brief 025 task D2): an active row on a new row's key that the plan didn't read would be left
      // current beside it, so the change is extraction's.
      let beside = false;
      for (const p of puts) {
        if (p.expectRev !== null) continue;
        for (const m of await sameKeyRows(tx, a.uid, p.row.key)) if (!rows.has(m.logicalId) && !written.has(m.logicalId)) beside = true;
      }
      if (beside) {
        out.entries.push(deferred("transition", [...rows.values()].map(memRef)));
        continue;
      }
      // Brief 043: the same change said twice in one turn writes once; the second is never a second write of a row.
      if (puts.some((p) => written.has(p.id))) {
        out.entries.push(deferred("transition", []));
        continue;
      }
      for (const p0 of puts) {
        const p = p0.expectRev === null ? { ...p0, row: rootedAtTurnSlice(p0.row, ev, a.hasher) } : p0;
        out.commands.push(p);
        written.set(p.id, p.row);
      }
      // Brief 043, finding 8: a change that writes nothing is deferred, so extraction can still apply it.
      if (puts.length === 0) {
        out.entries.push(deferred("transition", []));
        continue;
      }
      wroteTransition = true;
      const refs = [...new Map([...[...rows.values()].map(memRef), ...puts.map((p) => memRef(p.row))].map((r) => [r.id, r])).values()];
      out.entries.push({ route: "transition", outcome: "applied", keys: [...new Set(puts.map((p) => p.row.key))].slice(0, HANDLED_KEYS_MAX), refs: refs.slice(0, HANDLED_REFS_MAX), ruleKeys: [] });
    }
  }
  out.overlay = [...written.values()];
  out.changed = written.size > 0;
  out.transitionOnly = wroteTransition && !wroteCorrection;
  return out;
}

/** Writes the plan's Memory Commands in the turn's transaction. */
export function writeMemoryCommands(tx: Pick<Tx, "create" | "update">, uid: string, commands: readonly Extract<Command, { op: "putMemory" }>[]): void {
  for (const c of commands) {
    if (c.expectRev === null) tx.create(paths.memory(uid, c.id), c.row);
    else tx.update(paths.memory(uid, c.id), c.row);
  }
}

/** The context's Memories with the plan's rows laid over them, and a Snapshot that holds them and the turn (G16). */
export function overlay(context: OnTurnContext, rows: readonly Memory[], evidence: { eid: string; record: unknown; rev: number } | null): { memories: HeadMemory[]; snapshot: Snapshot } {
  const byId = new Map(context.memories.map((m) => [m.id, m]));
  for (const m of rows) byId.set(m.logicalId, { id: m.logicalId, memory: m });
  const memories = [...byId.values()];
  const s = context.snapshot;
  const refs = [...s.refs];
  const snapRows = [...s.rows];
  for (const m of rows) {
    const at = refs.findIndex((r) => r.collection === "memories" && r.id === m.logicalId);
    const ref = { collection: "memories" as const, id: m.logicalId, parentId: null, rev: m.rev };
    if (at >= 0) {
      refs[at] = ref;
      snapRows[at] = m as Snapshot["rows"][number];
    } else {
      refs.push(ref);
      snapRows.push(m as Snapshot["rows"][number]);
    }
  }
  if (evidence !== null && !refs.some((r) => r.collection === "evidence" && r.id === evidence.eid)) {
    refs.push({ collection: "evidence", id: evidence.eid, parentId: null, rev: evidence.rev });
    snapRows.push(evidence.record as Snapshot["rows"][number]);
  }
  return { memories, snapshot: { ...s, refs, rows: snapRows } };
}
