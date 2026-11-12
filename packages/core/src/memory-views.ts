/**
 * What the screen may read about memory (contracts §6 GET /api/memory, §7 `snapshot()`; spec §6, §11, §15; brief 020).
 * Pure: the server reads the rows, these functions decide what crosses. No clock, store or network.
 *
 *   - One test decides what is shown: `shown(row)` is `spokenGrade` (which runs the one `eligible` function) plus the
 *     audience's ceiling (`shownCeiling`). A row that is forgotten (below the current epoch), blocked, wrong, dirty,
 *     a guess, third-party, S2 or never-outbound is never shown.
 *   - `snapshot()` groups what is shown for a person to read: 50 cards a page over a floor of 200 rows, topic
 *     counts, and two recent told lines. Guesses and private things are counts only.
 *   - The readout ("What do you know about me?") is every page of `snapshot()`, recent told lines first, capped at
 *     200 lines. Every line is the row's own stored line, so nothing new is said.
 *   - The Lab counts distinct rows and distinct decisions. Numbers with no source yet are 0 on the wire and named in
 *     `limits` as `uncounted:<field>`, so the screen shows them as not counted.
 *   - The strip reads the newest live loop. The inspect views (`item`, `why`, `receipt`) return InspectItems.
 */
import { type DocRef, type EC, type Snapshot, docRef, eligible } from "./eligible";
import { recallLineText } from "./recall";
import type { Au, Cov, ID, Ref, Sens } from "./schema/primitives";
import type { Evidence, Ledger, Memory } from "./schema/records";
import type { Card, InspectItem, LabView, SnapshotView, StripView, W } from "./schema/wire";
import { spokenGrade } from "./spoken";

/** The most rows one snapshot reads (contracts §6 snapshot "floor200"). */
export const SNAPSHOT_FLOOR = 200;
/** Cards per snapshot page (contracts §6 snapshot "Page50"). */
export const SNAPSHOT_PAGE = 50;
/** Topic counts in an overview (SnapshotView.overview.topics). */
export const SNAPSHOT_TOPICS = 24;
/** Recent told lines in an overview, and the two the readout adds (spec §15). */
export const RECENT_TOLD = 2;
/** The readout's cap (spec §11: the floor's one read is capped at 200). */
export const READOUT_MAX_LINES = 200;
/** InspectItem label length. */
const LABEL_CHARS = 160;
/** Root quotes the `why` view returns, after the row itself. */
const WHY_ROOTS = 8;

export interface ViewRow {
  id: ID;
  memory: Memory;
}

export interface ViewContext {
  ec: EC;
  snapshot: Snapshot;
  /** The note ID for a recent told line, from the Memory's ID. */
  noteFor: (memoryId: ID) => ID;
  expiresAt: string;
}

export interface ReadoutLine {
  id: ID;
  text: string;
  sens: Sens;
}

const RANK: Record<Sens, number> = { S0: 0, S1: 1, S2: 2 };

/**
 * Ruling (brief 020, fails closed): the highest Sensitivity the screen shows for an audience. A private session
 * shows S0 and S1 (spec §6 ceiling); company and unknown show S0 only (spec §6 Audience: company holds S1+;
 * unknown has no code template on the screen, so it is treated as company).
 */
export function shownCeiling(audience: Au): Sens {
  switch (audience) {
    case "private":
      return "S1";
    case "company":
    case "unknown":
      return "S0";
    default:
      audience satisfies never;
      return "S0";
  }
}

const COMPLETE: Cov = { state: "complete", from: null, to: null, missingRanges: [], generation: 0 };
const PARTIAL: Cov = { ...COMPLETE, state: "partial" };

const refOf = (r: ViewRow): DocRef => docRef("memories", r.id, r.memory.rev);
const memoryRef = (r: ViewRow): Ref => ({ type: "memory", id: r.id, rev: r.memory.rev });
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const underCeiling = (sens: Sens, audience: Au) => RANK[sens] <= RANK[shownCeiling(audience)];

/** The one test for what the screen and the readout may show. */
export function shown(r: ViewRow, ctx: ViewContext): boolean {
  if (!spokenGrade({ ref: refOf(r), row: r.memory }, ctx.ec, ctx.snapshot).allow) return false;
  return underCeiling(r.memory.sens, ctx.ec.audience);
}

/** A live row, for counts only: eligible to read and active. Never shown by this test alone. */
function counted(r: ViewRow, ec: EC, s: Snapshot): boolean {
  return r.memory.status === "active" && eligible({ ref: refOf(r), row: r.memory }, { ...ec, stage: "read" }, s).allow;
}

/** The shown rows in the fixed reading order: predicate, key, ID. */
function shownRows(rows: readonly ViewRow[], ctx: ViewContext): ViewRow[] {
  return rows
    .filter((r) => shown(r, ctx))
    .sort((a, b) => cmp(a.memory.predicate, b.memory.predicate) || cmp(a.memory.key, b.memory.key) || cmp(a.id, b.id));
}

function cardOf(r: ViewRow): Card {
  const line = recallLineText(r.memory);
  return { id: r.id, kind: "memory", title: line.slice(0, LABEL_CHARS), lines: [line], sources: [memoryRef(r)], sens: r.memory.sens };
}

function toldNote(r: ViewRow, ctx: ViewContext): W {
  return {
    noteId: ctx.noteFor(r.id),
    rev: 1,
    kind: "truth",
    text: recallLineText(r.memory),
    rootKeys: r.memory.rootKeys.slice(0, 128),
    dependsOn: r.memory.dependsOn.slice(0, 256),
    sens: r.memory.sens,
    expiresAt: ctx.expiresAt,
    unprompted: false,
    momentId: null,
    tokens: [],
  };
}

/** Counted rows that are not shown: guesses (class M) and private things (told or own, but over the ceiling). */
function heldCounts(rows: readonly ViewRow[], shownIds: ReadonlySet<string>, ctx: ViewContext): { guesses: number; heldPrivate: number } {
  let guesses = 0;
  let heldPrivate = 0;
  for (const r of rows) {
    if (shownIds.has(r.id) || !counted(r, ctx.ec, ctx.snapshot)) continue;
    const m = r.memory;
    if (m.sourceClass === "M") guesses++;
    else if ((m.sourceClass === "U" || m.sourceClass === "C" || m.sourceClass === "O") && (m.flow === "never_outbound" || !underCeiling(m.sens, ctx.ec.audience))) heldPrivate++;
  }
  return { guesses, heldPrivate };
}

/**
 * `snapshot(rows, c, cursor)` (contracts §7, §6 snapshot). Null when the cursor names no shown row (the caller
 * answers SCOPE). `truncated` is set when more than SNAPSHOT_FLOOR rows were shown-eligible.
 */
export function snapshot(rows: readonly ViewRow[], ctx: ViewContext, cursor: ID | null): SnapshotView | null {
  return snapshotOver(shownRows(rows, ctx), rows, ctx, cursor, null);
}

/** One snapshot page over rows already found shown, in reading order; `held` reuses the counts of an earlier page. */
function snapshotOver(
  all: readonly ViewRow[],
  rows: readonly ViewRow[],
  ctx: ViewContext,
  cursor: ID | null,
  held: { guesses: number; heldPrivate: number } | null,
): SnapshotView | null {
  const floor = all.slice(0, SNAPSHOT_FLOOR);
  const truncated = all.length > floor.length;
  let start = 0;
  if (cursor !== null) {
    const at = floor.findIndex((r) => r.id === cursor);
    if (at < 0) return null;
    start = at + 1;
  }
  const page = floor.slice(start, start + SNAPSHOT_PAGE);
  const more = start + SNAPSHOT_PAGE < floor.length;

  const topics = new Map<string, number>();
  for (const r of floor) topics.set(r.memory.predicate, (topics.get(r.memory.predicate) ?? 0) + 1);
  const { guesses, heldPrivate } = held ?? heldCounts(rows, new Set(all.map((r) => r.id)), ctx);
  const recentTold = floor
    .filter((r) => r.memory.sourceClass === "U" || r.memory.sourceClass === "C")
    .sort((a, b) => cmp(b.memory.assertedAt, a.memory.assertedAt) || cmp(a.id, b.id))
    .slice(0, RECENT_TOLD)
    .map((r) => toldNote(r, ctx));

  return {
    cards: page.map(cardOf),
    overview: {
      topics: [...topics.entries()]
        .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
        .slice(0, SNAPSHOT_TOPICS)
        .map(([predicate, count]) => ({ predicate: predicate as Memory["predicate"], count })),
      guesses,
      heldPrivate,
      recentTold,
    },
    coverage: truncated || !ctx.snapshot.complete ? PARTIAL : COMPLETE,
    truncated,
    cursor: more && page.length > 0 ? page[page.length - 1]!.id : null,
  };
}

/**
 * The readout from snapshot pages read in order: the first page's recent told lines, then every card's line, each
 * row once, at most READOUT_MAX_LINES. `noteRow` maps a told line's note ID to its row ID, so a row is said once.
 */
export function readoutFromPages(pages: readonly SnapshotView[], noteRow: (noteId: ID) => ID | null = () => null): ReadoutLine[] {
  const out: ReadoutLine[] = [];
  const seenIds = new Set<string>();
  const seenText = new Set<string>();
  const add = (id: ID, text: string, sens: Sens) => {
    if (out.length >= READOUT_MAX_LINES || seenIds.has(id) || seenText.has(text) || text === "") return;
    seenIds.add(id);
    seenText.add(text);
    out.push({ id, text, sens });
  };
  for (const w of pages[0]?.overview.recentTold ?? []) add(noteRow(w.noteId as ID) ?? (w.noteId as ID), w.text, w.sens);
  for (const p of pages) for (const c of p.cards) add(c.id as ID, c.lines[0] ?? "", c.sens);
  return out;
}

/** Every page of `snapshot()` read as one readout (spec §15, §11). */
export function readout(rows: readonly ViewRow[], ctx: ViewContext): { lines: ReadoutLine[]; truncated: boolean } {
  const all = shownRows(rows, ctx);
  const pages: SnapshotView[] = [];
  let cursor: ID | null = null;
  for (let i = 0; i * SNAPSHOT_PAGE < SNAPSHOT_FLOOR; i++) {
    const page = snapshotOver(all, rows, ctx, cursor, pages[0]?.overview ?? null);
    if (page === null) break;
    pages.push(page);
    cursor = page.cursor as ID | null;
    if (cursor === null) break;
  }
  const byNote = new Map(rows.map((r) => [ctx.noteFor(r.id), r.id] as const));
  const lines = readoutFromPages(pages, (noteId) => byNote.get(noteId) ?? null);
  return { lines, truncated: all.length > lines.length };
}

function itemOf(r: ViewRow): InspectItem {
  const line = recallLineText(r.memory);
  return { id: r.id, kind: "memory", label: line.slice(0, LABEL_CHARS), body: line, status: "active", refs: [memoryRef(r)] };
}

/** The `item` view: the one shown row with this ID, or nothing. */
export function itemView(rows: readonly ViewRow[], id: ID, ctx: ViewContext): InspectItem[] {
  const r = rows.find((x) => x.id === id);
  return r === undefined || !shown(r, ctx) ? [] : [itemOf(r)];
}

/** Evidence kinds as the `why` view's labels (shown under "Sources"). */
const EVIDENCE_LABEL: Record<Evidence["kind"], string> = {
  turn: "You said",
  message: "An email",
  calendar: "Your calendar",
  transaction: "Your bank",
  receipt: "A receipt",
  note: "A note",
  task: "A task",
  food: "A food log",
};

/**
 * The `why` view ("How do you know?" walks the roots, spec §6): the shown row, then each root's quoted words, only
 * where the root's Slice is at or under the audience's ceiling and its Evidence is retained and current.
 */
export function whyView(rows: readonly ViewRow[], evidence: ReadonlyMap<string, Evidence>, id: ID, ctx: ViewContext): InspectItem[] {
  const r = rows.find((x) => x.id === id);
  if (r === undefined || !shown(r, ctx)) return [];
  const out: InspectItem[] = [itemOf(r)];
  for (const s of r.memory.rootSlices) {
    if (out.length > WHY_ROOTS) break;
    if (!underCeiling(s.sens, ctx.ec.audience) || s.start === null || s.end === null || s.fieldPath !== "text") continue;
    const ev = evidence.get(s.eid);
    if (ev === undefined || ev.status !== "retained" || ev.uid !== ctx.ec.uid || ev.epoch < ctx.ec.epoch || ev.dirty) continue;
    const text = ev.text?.kind === "inline" ? ev.text.text : null;
    if (text === null || s.end > text.length) continue;
    const quote = text.slice(s.start, s.end);
    if (quote === "" || out.some((o) => o.id === s.eid)) continue;
    out.push({ id: s.eid, kind: "evidence", label: EVIDENCE_LABEL[ev.kind], body: quote.slice(0, 2048), status: "active", refs: [{ type: "evidence", id: s.eid, rev: ev.rev }] });
  }
  return out;
}

/** The counts a forget receipt carries in its InspectItem body (kinds and counts only, never text). */
export interface ReceiptCounts {
  retainedRules: number;
  scopePending: boolean;
  withdrawnCount: number;
  touched: { collection: string; count: number }[];
}

/**
 * The `receipt` view: one InspectItem for a `forgetReceipt` ledger entry, status `cleaned` once cleanup completed,
 * `blocked` once blocked, else `pending`. InspectItem has no count fields, so the body is the JSON of ReceiptCounts.
 */
export function receiptView(entry: { id: ID; ledger: Ledger } | null): InspectItem[] {
  if (entry === null || entry.ledger.kind !== "forgetReceipt") return [];
  const p = entry.ledger.payload;
  const counts: ReceiptCounts = { retainedRules: p.retainedRuleIds.length, scopePending: p.scopePending, withdrawnCount: p.withdrawnCount, touched: p.touched.map((t) => ({ collection: t.collection, count: t.count })) };
  const status = p.cleanupCompleteAt !== null ? "cleaned" : p.blockedAt !== null ? "blocked" : "pending";
  return [{ id: entry.id, kind: "receipt", label: "forgetReceipt", body: JSON.stringify(counts), status, refs: [{ type: "ledger", id: entry.id, rev: entry.ledger.rev }] }];
}

export interface LabInput {
  ec: EC;
  snapshot: Snapshot;
  memories: readonly ViewRow[];
  evidence: readonly { id: string; evidence: Evidence }[];
  /** Ledger entries read for the Lab; non-decisions are ignored, and an ID read twice counts once. */
  decisions: readonly { id: string; entry: Ledger }[];
  /** False when a read stopped at its cap. */
  complete: boolean;
}

/** LabView numbers with no source in this build: 0 on the wire, named in `limits`, shown as not counted. */
export const LAB_UNCOUNTED = ["steered", "declined", "falseHolds", "overForget", "foodWithoutSuggest"] as const satisfies readonly (keyof LabView)[];
/** The floor reads every line in one read (spec §11: "and the Lab says so"). */
export const LAB_FLOOR_RECALL = "floorRecall";

/** The Lab (contracts §6 line 749: distinct decisions; guessLinesSpoken = guess-rooted). */
export function labView(input: LabInput): LabView {
  const { ec, snapshot: s } = input;
  const emails = new Set<string>();
  for (const e of input.evidence) if (e.evidence.kind === "message" && e.evidence.status === "retained" && e.evidence.uid === ec.uid) emails.add(e.id);
  const guessIds = new Set<string>();
  const privateGuesses = new Set<string>();
  for (const r of input.memories) {
    if (r.memory.sourceClass !== "M") continue;
    guessIds.add(r.id);
    if (r.memory.sens !== "S0" && counted(r, ec, s)) privateGuesses.add(r.id);
  }
  const delivered = new Set<string>();
  const held = new Set<string>();
  const blocked = new Set<string>();
  const guessSpoken = new Set<string>();
  for (const { id, entry } of input.decisions) {
    if (entry.kind !== "decision" || entry.uid !== ec.uid) continue;
    if (entry.state === "complete") {
      delivered.add(id);
      if (entry.payload.acceptedRefs.some((r) => r.type === "memory" && guessIds.has(r.id))) guessSpoken.add(id);
    }
    if (entry.state === "blocked") held.add(id);
    if (entry.payload.reasonCodes.includes("blocked")) blocked.add(id);
  }
  return {
    readEmails: emails.size,
    privateGuesses: privateGuesses.size,
    guessLinesSpoken: guessSpoken.size,
    delivered: delivered.size,
    held: held.size,
    steered: 0,
    declined: 0,
    blocked: blocked.size,
    falseHolds: 0,
    overForget: 0,
    foodWithoutSuggest: 0,
    coverage: input.complete && s.complete ? COMPLETE : PARTIAL,
    limits: [LAB_FLOOR_RECALL, ...LAB_UNCOUNTED.map((f) => `uncounted:${f}`)],
  };
}

/**
 * The strip: the newest live Memory carrying a loop, at or under the audience's ceiling. A loop is written only when
 * the owner said yes, so noticed, connected, suggested and accepted are complete; the comparison is complete once
 * the loop is `eligible` or `celebrated`. Labels are the step kinds; the browser words them. No loop: no steps.
 */
export function stripView(rows: readonly ViewRow[], ctx: ViewContext): StripView {
  const r = rows
    .filter((x) => x.memory.loop !== null && counted(x, ctx.ec, ctx.snapshot) && underCeiling(x.memory.sens, ctx.ec.audience))
    .sort((a, b) => cmp(b.memory.assertedAt, a.memory.assertedAt) || cmp(a.id, b.id))[0];
  if (r === undefined || r.memory.loop === null) return { loopId: null, steps: [] };
  const loop = r.memory.loop;
  const compared = loop.state === "eligible" || loop.state === "celebrated";
  const done = (kind: "noticed" | "connected" | "suggested" | "accepted", ledgerId: ID | null = null) => ({ kind, state: "complete" as const, label: kind, ledgerId });
  return {
    loopId: r.id,
    steps: [
      done("noticed"),
      done("connected"),
      done("suggested"),
      done("accepted", loop.acceptedActionId as ID),
      { kind: "comparison", state: compared ? "complete" : "pending", label: "comparison", ledgerId: null },
    ],
  };
}
