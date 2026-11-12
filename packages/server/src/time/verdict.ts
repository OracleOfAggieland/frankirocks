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
  isMustSay,
  msFromTs,
  parseDep,
  sourceVerdict,
  withMomentDefaults,
} from "@franki/core";
import { ownerClock } from "../core-docs";
import { foregroundEC, readAllMemories } from "../head-build";
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
  const ec = { ...foregroundEC(uid, core.epoch.data, { ...pair, worldClock: { ...pair.worldClock, now: world } }, 0), stage: "speech" as const, purpose: "proactive" as const };
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

/**
 * A reminder's source, reread like any other moment's (brief 036 finding 10): every row the action depends on must
 * still stand. An action with no source (written before the fix) fails closed.
 */
async function reminderSourceVerdict(r: Reader, uid: string, moment: Moment, dependsOn: readonly string[], core: Core, clock: ClockPort): Promise<MomentVerdict> {
  if (dependsOn.length === 0) return "gone";
  for (const dep of dependsOn) {
    const parsed = parseDep(dep);
    if (parsed === null) return "gone";
    if (parsed.collection === "memories") {
      const current = (await r.get<Memory>(paths.memory(uid, parsed.id)))?.data ?? null;
      const plain = sourceVerdict(current);
      if (plain !== "ok" || current === null) return plain;
      const v = await rowVerdict(r, uid, moment, current, parsed.id, [parsed.id], core, clock);
      if (v !== "ok") return v;
    } else {
      const e = await r.get<Evidence>(paths.evidence(uid, parsed.id));
      if (e === null || e.data.purgedAt !== null) return "gone";
      const blocks = await r.query<Block>({ collection: paths.collection(uid, "blocks"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: REREAD_MAX });
      const pair = ownerClock(core.state.data, clock);
      const ref = docRef("evidence", e.id, e.data.rev);
      const ec = { ...foregroundEC(uid, core.epoch.data, pair, 0), stage: "speech" as const, purpose: "proactive" as const };
      const snapshot: Snapshot = { uid, epoch: core.epoch.data, session: null, job: null, localGeneration: 0, refs: [ref], rows: [e.data], blocks: blocks.map((b) => b.data), coverage: core.state.data.coverage, complete: blocks.length < REREAD_MAX };
      const er = eligible({ ref, row: e.data }, ec, snapshot);
      if (!er.allow) return er.reason === "blocked" ? "forgotten" : "gone";
    }
  }
  return "ok";
}

/** What a reread says about `moment`'s source now. `r` is a transaction when the caller writes on the answer. */
export async function momentVerdict(r: Reader, uid: string, moment: Moment, core: Core, clock: ClockPort, opts: VerdictOptions): Promise<MomentVerdict> {
  let v: MomentVerdict = "gone";
  let action: StoredDoc<Ledger> | null = null;
  if (moment.memoryId !== null) v = await memoryVerdict(r, uid, moment, moment.memoryId, core, clock);
  else if (moment.rollupId !== null) v = opts.rollupLive === false ? "gone" : "ok";
  else if (moment.actionId !== null) {
    action = await r.get<Ledger>(paths.ledger(uid, moment.actionId));
    if (action === null || action.data.kind !== "action" || action.data.state !== "complete") return "gone";
    v = await reminderSourceVerdict(r, uid, moment, action.data.dependsOn, core, clock);
  }
  // Brief 041 part 3 (spec §7, the death and illness rows), reread wherever this verdict is (the tick, `chooseNow`,
  // the render and admission), so a life change committed at any point before admission holds: a moment about
  // someone recorded deceased is `gone`, except the one grief form the spec names and a must-say the owner confirmed
  // after the death was recorded (W-228); a wish or celebrate about someone whose care is open at gravity 3, or about
  // anyone one hop from them, waits as `gone`; a check-in about a person whose care is all recorded resolved is
  // `gone`. The tick then closes it with a reason code (`policy`).
  if (v !== "ok" || moment.kind === "griefAsk") return v;
  // The moment's roots: its subjects, its source row's (and its note's, for a moved occasion), and for a reminder the
  // rows its action depends on. Read from the view, so a pass over many moments reads the Memories once (W-229).
  const lazy = { view: null as LifeView | null };
  const view = async () => (lazy.view ??= await lifeView(r, uid));
  const rowIds = [
    ...(moment.memoryId === null ? [] : [moment.memoryId]),
    ...(moment.payload.kind === "cue" && moment.payload.noteRef.type === "memory" ? [moment.payload.noteRef.id] : []),
    ...(action === null ? [] : action.data.dependsOn.flatMap((d) => { const p = parseDep(d); return p !== null && p.collection === "memories" ? [p.id] : []; })),
  ];
  const own = moment.subjectIds.filter((e) => e !== "self");
  if (own.length === 0 && rowIds.length === 0) return v;
  const life = await view();
  const roots = new Set([...own, ...rowIds.flatMap((id) => life.rowEntities.get(id) ?? [])]);
  if (roots.size === 0) return v;
  const died = [...roots].map((e) => life.deceasedAt.get(e)).filter((t): t is number => t !== undefined);
  if (died.length > 0) {
    // W-228: a must-say plays only when its confirmation is strictly after the latest death it is about. A missing
    // time on either side counts as before.
    const worldNow = ownerClock(core.state.data, clock).worldClock.now;
    const confirmedAt = action === null ? NaN : msFromTs(action.data.createdAt);
    const after = Number.isFinite(confirmedAt) && died.every((t) => Number.isFinite(t) && confirmedAt > t);
    if (!(isMustSay(moment.kind, msFromTs(moment.dueAt), worldNow) && after)) return "gone";
  }
  if ((moment.kind === "wish" || moment.kind === "celebrate") && [...roots].some((e) => life.graveLinked.has(e))) return "gone";
  if (moment.kind === "checkIn" && [...roots].some((e) => life.careResolved.has(e))) return "gone";
  return v;
}

/**
 * What the life check needs (brief 041 part 3, W-229), read once per Reader: `chooseNow` passes one reader for every
 * moment it checks, and a transaction is one reader. A memo per Reader object, so no caller passes anything new and
 * a later reader (a new pass, a new transaction) reads afresh, never a stale view.
 *
 * No declared index serves this read. The store allows only the shapes in `store/indexes.ts` (the composite indexes
 * in `firestore.indexes.json`, and reads by ID), and none selects by `predicate`, so the life facts come from one
 * paged scan of the Memories by ID, keeping only what the check uses. A composite index on (`predicate`, `status`)
 * would let it read just the active `person.life` and `care` rows; the one-hop link and a moment's roots would then
 * need an `entityIds` array-contains read per ill person and the source rows by ID.
 */
interface LifeView {
  /** Each entity recorded deceased, and when (ops clock, the row's `createdAt`; the latest such row). */
  deceasedAt: Map<string, number>;
  /** Someone whose care is open at gravity 3, and every entity one hop from them (never `self`). */
  graveLinked: Set<string>;
  /** People whose care rows are all recorded resolved. */
  careResolved: Set<string>;
  /** Each row's subject and entities, `self` left out, by document ID (the other fields read active rows only). */
  rowEntities: Map<string, string[]>;
}

const LIFE_VIEWS = new WeakMap<Reader, Promise<LifeView>>();

function lifeView(r: Reader, uid: string): Promise<LifeView> {
  let p = LIFE_VIEWS.get(r);
  if (p === undefined) {
    p = loadLifeView(r, uid);
    LIFE_VIEWS.set(r, p);
    // A failed read is not kept: the next call reads again.
    p.catch(() => LIFE_VIEWS.delete(r));
  }
  return p;
}

async function loadLifeView(r: Reader, uid: string): Promise<LifeView> {
  const rows = await readAllMemories(r, uid);
  const code = (m: Memory) => (m.value.kind === "enum" ? m.value.code : null);
  const careOf = (m: Memory): string | null => (m.predicate !== "care" ? null : String((m.args as { careSubjectRef?: unknown }).careSubjectRef ?? m.subjectId));
  const view: LifeView = { deceasedAt: new Map(), graveLinked: new Set(), careResolved: new Set(), rowEntities: new Map() };
  const care = new Map<string, string[]>();
  const ill = new Set<string>();
  for (const { id, memory: m } of rows) {
    view.rowEntities.set(id, [m.subjectId, ...m.entityIds].filter((e) => e !== "self"));
    if (m.status !== "active") continue;
    if (m.predicate === "person.life" && code(m) === "deceased") view.deceasedAt.set(m.subjectId, Math.max(view.deceasedAt.get(m.subjectId) ?? -Infinity, msFromTs(m.createdAt)));
    const c = careOf(m);
    if (c === null) continue;
    care.set(c, [...(care.get(c) ?? []), code(m) ?? ""]);
    if (code(m) === "open" && m.gravity >= 3) ill.add(c);
  }
  for (const [e, codes] of care) if (codes.every((x) => x === "resolved")) view.careResolved.add(e);
  // One hop (spec §7: "code walks one hop over entities"): an entity that shares an active row with the ill person.
  for (const e of ill) view.graveLinked.add(e);
  for (const { id, memory: m } of rows) {
    if (m.status !== "active") continue;
    const es = view.rowEntities.get(id)!;
    if (es.some((e) => ill.has(e))) for (const e of es) view.graveLinked.add(e);
  }
  return view;
}

/**
 * The note ID a moment travels as on the wire, bound to the lease it was put out under (brief 036 finding 1). A
 * re-plan, a new lease or a new generation changes it, so a permit issued before no longer admits.
 */
export const momentNoteId = (hasher: { id(parts: unknown): string }, momentId: string, m: Pick<Moment, "generation" | "leaseToken">): string =>
  hasher.id(["momentNote", momentId, m.generation, m.leaseToken]);
