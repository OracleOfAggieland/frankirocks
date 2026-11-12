/**
 * The food and hero-loop tool handlers (brief 022; spec §10; contracts `suggest`, `answer`, Money; KJ01 to KJ03).
 * Code picks and code counts: `suggest(food)` filters the recipe catalog by every attendee's rules and picks three;
 * the hero offer is the `takeout_late_meeting_v1` detector over the owner's bank and calendar Evidence; "yes" writes
 * the grocery list and the loop; the comparison reads the loop and compares equal windows from rows.
 *
 *   - `suggestTool` and `answerTool` are called from one dispatch line each in routes/tool.ts, after its stamp and
 *     parse checks, and their output goes through the Admission_Seam there.
 *   - `heroOffer` and `compareLoop` are for the later briefs that put the pattern on a moment and the comparison on
 *     the strip (023's `derive`); no voice tool reaches them.
 *
 * Every read goes through `eligible`, so a blocked or purged row never counts. Nothing is said to be done before
 * its write commits: `answerTool` returns after its transaction.
 */
import {
  type Card,
  type ClockPair,
  type CoreRules,
  type Cov,
  type Evidence,
  type FoodCandidate,
  type FoodRule,
  type Infer,
  type Ledger,
  type LoopRecord,
  type LoopResult,
  type Memory,
  type PatternResult,
  type Ref,
  type Session,
  type Snapshot,
  type Stamp,
  type ToolCall,
  type ToolResult,
  type Turn,
  type BankRow,
  type MeetingRow,
  type ReceiptRow,
  CATALOG_VERSION,
  METRIC_CATEGORIES,
  POSTING_LAG_DAYS,
  addCivilDays,
  celebration,
  civilDateAt,
  docRef,
  eligible,
  groceryItems,
  heroOfferCardLines,
  heroOfferLine,
  heroOfferParts,
  heroWindow,
  ingredient,
  isPlainYes,
  loopPredicate,
  moreSourcesLine,
  planHeroLoop,
  rootKey,
  suggestFood,
  takeoutLateMeetingV1,
  tsFromMs,
} from "@franki/core";
import { readCoreDocs, ownerClock } from "../core-docs";
import { heroAnchor } from "../time/hero-anchor";
import { forgetRowsFor } from "../forget/snapshot-rows";
import { foregroundEC, storeReader } from "../head-build";
import { cFields } from "../records";
import type { Reader, Tx } from "../store/port";
import { renderedEntryId } from "../time/reminder";
import { paths } from "../store/paths";
import type { RouteContext } from "./runtime";

type Result = Infer<typeof ToolResult>;
type SuggestArgs = Extract<ToolCall, { name: "suggest" }>["args"];
type AnswerArgs = Extract<ToolCall, { name: "answer" }>["args"];

/** The hero's currency. Rows in any other currency are excluded, never converted. */
export const HERO_CURRENCY = "USD";
/**
 * Evidence is read by document ID (Q28; no index by kind exists), so every page is read. Past this many documents the
 * read stops and the hero says nothing (fails closed). Brief 037, finding 6: this bounds the scan only; the caps that
 * matter, MONEY_ROWS_MAX, apply after the rows are filtered to the window and the category.
 */
export const EVIDENCE_SCAN_MAX = 50_000;
/**
 * At most this many rows of each kind go to the detector (contracts: Purchase[<=128], CalendarEvent[<=128]), counted
 * after filtering to the window (plus the posting lag) and the category (brief 037, finding 6). More, and the hero
 * says nothing.
 */
export const MONEY_ROWS_MAX = 128;
/**
 * Brief 037, finding 2. Nobody on the server knows who is at the table, so the food paths filter by every stored
 * rule of every subject, always: over-filtering is the safe error. The model's `attendeeIds` may add to the set and
 * never narrow it. One line to change when code resolves attendees.
 */
export const FILTER_EVERY_SUBJECT = true;

const UNKNOWN_COV: Cov = { state: "unknown", from: null, to: null, missingRanges: [], generation: 0 };
const COMPLETE_COV: Cov = { state: "complete", from: null, to: null, missingRanges: [], generation: 0 };

// ---------------------------------------------------------------------------------------------
// Reading the owner's money and calendar rows

interface MoneyRows {
  bank: BankRow[];
  receipts: ReceiptRow[];
  events: MeetingRow[];
  coverage: Cov;
  clock: ClockPair;
  evidence: Map<string, Evidence>;
  /** Brief 030 P1-1: the last date of the live hero insight's window, or null (the window then ends yesterday). */
  anchor: string | null;
}

/** The dates and categories a reader needs: rows outside them can't change its result. */
interface MoneyScope {
  fromCivil: string;
  toCivil: string;
  categories: readonly BankRow["bank"]["category"][];
  meetings: boolean;
}

async function scanEvidence(reader: Reader, uid: string): Promise<{ id: string; data: Evidence }[] | null> {
  const out: { id: string; data: Evidence }[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { id: string; data: Evidence }[] = await reader.query<Evidence>({
      collection: paths.collection(uid, "evidence"),
      where: cursor === null ? [] : [{ field: "__name__", op: ">", value: cursor }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: 100,
    });
    out.push(...page);
    if (out.length > EVIDENCE_SCAN_MAX) return null;
    if (page.length < 100) return out;
    cursor = page[page.length - 1]!.id;
  }
}

/**
 * The money rows that can change a result over `scope` (brief 037, finding 6), widened by a day each side for zones:
 *   - a bank row in a counted category, or any refund, with a known date (purchase or posting) from the window's
 *     first date to the posting lag after its last; a row with no known date is kept;
 *   - a negative row posted on or after the window's first date (it may refund a counted order), and every row that
 *     names a kept row as the order it refunds;
 *   - a receipt that names a kept bank row; a meeting starting in the window.
 */
function inScope(docs: readonly { id: string; data: Evidence }[], scope: MoneyScope, zone: string): { id: string; data: Evidence }[] {
  const from = addCivilDays(scope.fromCivil, -1);
  const to = addCivilDays(scope.toCivil, POSTING_LAG_DAYS + 1);
  const cats = new Set(scope.categories);
  const dateOf = (ts: string | null) => (ts === null ? null : civilDateAt(Date.parse(ts), zone));
  const bank = new Set<string>();
  for (const d of docs) {
    const o = d.data.observation;
    if (o.kind !== "bank" || (!cats.has(o.category) && o.refundOfId === null)) continue;
    const posted = dateOf(o.postedAt);
    const dates = [dateOf(o.purchaseAt.instant), o.purchaseAt.civilDate, posted].filter((x): x is string => x !== null);
    const keep = o.amountCents < 0 ? posted === null || posted >= from : dates.length === 0 || dates.some((x) => x >= from && x <= to);
    if (keep) bank.add(d.id);
  }
  for (const d of docs) {
    const o = d.data.observation;
    if (o.kind === "bank" && o.refundOfId !== null && bank.has(o.refundOfId)) bank.add(d.id);
  }
  return docs.filter((d) => {
    const o = d.data.observation;
    if (o.kind === "bank") return bank.has(d.id);
    if (o.kind === "receipt") return o.bankEvidenceId !== null && bank.has(o.bankEvidenceId);
    if (o.kind === "calendar") {
      if (!scope.meetings) return false;
      const day = dateOf(o.start);
      return day !== null && day >= from && day <= addCivilDays(scope.toCivil, 1);
    }
    return false;
  });
}

/** The eligible bank, receipt and calendar rows over a scope, or null when they can't all be read (fails closed). */
async function readMoneyRows(ctx: RouteContext, generation: number, scopeOf: (clock: ClockPair, anchor: string | null) => MoneyScope): Promise<MoneyRows | null> {
  const { uid, deps } = ctx;
  const reader = storeReader(deps.store, uid);
  const core = await readCoreDocs(reader, uid);
  const clock = ownerClock(core.state.data, deps.clock);
  const docs = await scanEvidence(reader, uid);
  if (docs === null) return null;
  const anchor = await heroAnchor(reader, uid, deps.hasher, clock.worldClock.now);
  const money = inScope(
    docs.filter((d) => ["transaction", "receipt", "calendar"].includes(d.data.kind)),
    scopeOf(clock, anchor),
    clock.worldClock.zone,
  );
  // Brief 030 P1-9 (brief 028 finding 3): the owner's blocks and overlays, as the read route's Snapshot carries them.
  const forget = await forgetRowsFor(reader, uid);
  const refs = [...money.map((d) => docRef("evidence", d.id, d.data.rev)), ...forget.refs];
  const snapshot: Snapshot = {
    uid,
    epoch: core.epoch.data,
    session: null,
    job: null,
    localGeneration: generation,
    refs: refs.slice(0, 4096),
    rows: [...money.map((d) => d.data), ...forget.rows].slice(0, 4096),
    blocks: forget.blocks,
    coverage: core.state.data.coverage,
    complete: refs.length <= 4096 && forget.complete,
  };
  const ec = { ...foregroundEC(uid, core.epoch.data, clock, generation), stage: "toolReturn" as const };
  const out: MoneyRows = { bank: [], receipts: [], events: [], coverage: core.state.data.coverage, clock, evidence: new Map(), anchor };
  for (const d of money) {
    if (!eligible({ ref: docRef("evidence", d.id, d.data.rev), row: d.data }, ec, snapshot).allow) continue;
    const o = d.data.observation;
    const rootKey = d.data.rootKeys[0] ?? d.id;
    if (d.data.kind === "transaction" && o.kind === "bank") out.bank.push({ id: d.id, rootKey, bank: o });
    else if (d.data.kind === "receipt" && o.kind === "receipt") out.receipts.push({ id: d.id, rootKey, receipt: o });
    else if (d.data.kind === "calendar" && o.kind === "calendar") out.events.push({ id: d.id, rootKey, calendar: o });
    else continue;
    out.evidence.set(d.id, d.data);
  }
  if (out.bank.length > MONEY_ROWS_MAX || out.receipts.length > MONEY_ROWS_MAX || out.events.length > MONEY_ROWS_MAX) return null;
  return out;
}

/** The hero's window from the clock and the live insight's anchor (brief 030 P1-1). */
function heroWindowOf(clock: ClockPair, anchor: string | null) {
  const zone = clock.worldClock.zone;
  // A live insight keeps its own window across a jump; heroWindow ends the day before `today`.
  const today = anchor !== null ? addCivilDays(anchor, 1) : civilDateAt(clock.worldClock.now, zone);
  return heroWindow(today, zone, HERO_CURRENCY);
}

const heroScope = (clock: ClockPair, anchor: string | null): MoneyScope => {
  const w = heroWindowOf(clock, anchor);
  return { fromCivil: w.fromCivil, toCivil: w.toCivil, categories: ["takeout"], meetings: true };
};

// ---------------------------------------------------------------------------------------------
// The hero offer

export interface HeroOffer {
  pattern: PatternResult;
  pendingId: string;
  yesId: string;
  noId: string;
  /** The offer, worded by code. */
  line: string;
  card: Card;
}

const evidenceRefs = (ids: readonly string[], evidence: Map<string, Evidence>, max: number): Ref[] =>
  ids.flatMap((id) => {
    const e = evidence.get(id);
    return e === undefined ? [] : [{ type: "evidence" as const, id, rev: e.rev }];
  }).slice(0, max);

/** A card holds at most this many sources (wire `Card.sources`). */
const CARD_SOURCES_MAX = 32;

function patternFor(rows: MoneyRows): PatternResult {
  return takeoutLateMeetingV1({
    purchases: rows.bank,
    receipts: rows.receipts,
    events: rows.events,
    // One coverage for both until connectors keep their own (design note 022, gap 13).
    bankCoverage: rows.coverage,
    calendarCoverage: rows.coverage,
    window: heroWindowOf(rows.clock, rows.anchor),
  });
}

function offerFrom(ctx: RouteContext, rows: MoneyRows): HeroOffer | null {
  const pattern = patternFor(rows);
  const line = heroOfferLine(pattern);
  ctx.deps.log("tool.heroPattern", { status: pattern.status, mostly: pattern.mostly, orders: pattern.orderCount, coveredDates: pattern.coveredDates, rows: rows.bank.length, events: rows.events.length, late: pattern.lateOrderCount });
  // Brief 037, finding 10: the card's lines are worded in core and every one passes the guard, or there's no offer.
  const lines = heroOfferCardLines(pattern);
  if (line === null || lines === null) return null;
  const pendingId = ctx.deps.hasher.id(heroOfferParts(pattern));
  const w = pattern.window;
  // Every counted row is cited, or the card says how many more there are; the count matches the rows left out.
  const cited = evidenceRefs([...w.purchaseIds, ...pattern.meetingIds, ...pattern.receiptIds], rows.evidence, Number.MAX_SAFE_INTEGER);
  const sources = cited.slice(0, CARD_SOURCES_MAX);
  const more = moreSourcesLine(cited.length - sources.length);
  const card: Card = {
    id: ctx.deps.hasher.id(["heroOfferCard", pendingId]),
    kind: "source",
    title: "Takeout and late meetings",
    lines: more === null ? lines : [...lines, more],
    sources,
    sens: "S1",
  };
  return { pattern, pendingId, yesId: ctx.deps.hasher.id(["heroOfferChoice", pendingId, "yes"]), noId: ctx.deps.hasher.id(["heroOfferChoice", pendingId, "no"]), line, card };
}

/** The hero offer now, or null when the pattern doesn't hold (or its rows can't all be read). */
export async function heroOffer(ctx: RouteContext, generation: number): Promise<HeroOffer | null> {
  const rows = await readMoneyRows(ctx, generation, heroScope);
  return rows === null ? null : offerFrom(ctx, rows);
}

// ---------------------------------------------------------------------------------------------
// suggest(food)

/**
 * A food tool's check and write, run inside the admission transaction (brief 037, finding 1). It reads only: given
 * the rules read there, it refuses (null, and the route is stale) when `rulesRev` isn't the stamp's or the dinners
 * those rules give aren't the ones answered; otherwise it returns the write to run after the Permit is issued.
 */
export type FoodWrite = (tx: Tx, rules: CoreRules) => Promise<(() => void) | null>;

export interface FoodOutcome {
  result: Result;
  /** Null when there is nothing to check: nothing food was answered. */
  write: FoodWrite | null;
}

/**
 * The rules every food path reads (brief 037, finding 11): `core/rules.allergies` and every open proposal's rules (a
 * late repair's or the backstop's, not yet installed by a turn or `open`). Pending filters as if active.
 */
export function foodRulesOf(rules: Pick<CoreRules, "allergies" | "proposals">): FoodRule[] {
  return [...rules.allergies, ...(rules.proposals ?? []).flatMap((p) => p.install)];
}

/** Everyone the food filter treats as eating (FILTER_EVERY_SUBJECT): the model's attendees plus every rule's subject. */
export function eatersOf(rules: readonly FoodRule[], modelIds: readonly string[]): string[] {
  const out = new Set(modelIds);
  if (FILTER_EVERY_SUBJECT) for (const r of rules) if (r.subjectId !== null) out.add(r.subjectId);
  return [...out].sort();
}

async function readRules(ctx: RouteContext): Promise<FoodRule[] | null> {
  try {
    const core = await readCoreDocs(storeReader(ctx.deps.store, ctx.uid), ctx.uid);
    return foodRulesOf(core.rules.data);
  } catch {
    return null;
  }
}

/** Three quick dinners for these rules, filtered for every subject they name. */
const dinnersFor = (rules: readonly FoodRule[] | null, modelIds: readonly string[] = []) => suggestFood({ rules, attendeeIds: rules === null ? modelIds : eatersOf(rules, modelIds) });

const candidateId = (ctx: RouteContext, c: FoodCandidate) => ctx.deps.hasher.id(["candidate", c.kind, CATALOG_VERSION, c.id, c.version]);

function foodCard(ctx: RouteContext, picked: readonly FoodCandidate[], title: string): Card {
  return {
    id: ctx.deps.hasher.id(["foodCard", picked.map((c) => c.id)]),
    kind: "food",
    title,
    lines: picked.map((c) => `${c.name}, ${c.minutes} minutes: ${c.ingredientIds.map((id) => ingredient(id)?.label ?? id).join(", ")}`.slice(0, 512)),
    sources: [],
    sens: "S0",
  };
}

/**
 * suggest(food). Brief 037, findings 1 and 11: the dinners are checked again in the admission transaction against the
 * rules read there (a proposal lands without raising `rulesRev`), and the route is stale when they differ.
 */
export async function suggestTool(ctx: RouteContext, stamp: Stamp, args: SuggestArgs): Promise<FoodOutcome> {
  if (args.domain !== "food") {
    return { result: { name: "suggest", candidateIds: [], selectedId: null, reason: "", pendingId: null, question: null, coverage: UNKNOWN_COV, cards: [] }, write: null };
  }
  const rules = await readRules(ctx);
  const out = dinnersFor(rules, args.attendeeIds);
  const picked = out.candidates.map((c) => c.id).join("|");
  const write: FoodWrite = async (_tx, now) => (now.rulesRev === stamp.rulesRev && dinnersFor(foodRulesOf(now), args.attendeeIds).candidates.map((c) => c.id).join("|") === picked ? () => undefined : null);
  ctx.deps.log("tool.suggest", { kept: out.filter.kept.length, removed: out.filter.removed.length, picked: out.candidates.length });
  const result: Result = {
    name: "suggest",
    candidateIds: out.candidates.map((c) => candidateId(ctx, c)),
    selectedId: out.selectedId === null ? null : candidateId(ctx, out.candidates[0]!),
    reason: out.reason?.text ?? "",
    pendingId: null,
    question: out.question,
    coverage: rules === null ? UNKNOWN_COV : COMPLETE_COV,
    cards: out.candidates.length === 0 ? [] : [foodCard(ctx, out.candidates, "Quick dinners")],
  };
  return { result, write: rules === null ? null : write };
}

// ---------------------------------------------------------------------------------------------
// answer: the hero offer's "yes"

type ActionEntry = Extract<Ledger, { kind: "action" }>;

/**
 * Brief 030 P1-2 (brief 029 finding 4; question X-166). Ruling, fails closed: a cited row's root Slice is its first
 * Slice with a text range. W-LINEAGE checks a root Slice's hash over its range, and a typed Slice (`bank.amount`,
 * `calendar.time`) has none, so it could never pass; the check itself stays as it is. Null when a cited row has no
 * such Slice: the yes is then stale, and nothing is written.
 */
export function loopRootSlice(e: Evidence): Evidence["fieldSlices"][number] | null {
  return e.fieldSlices.find((x) => x.start !== null && x.end !== null && x.start < x.end) ?? null;
}

/** The loop's lineage holds at most this many cited rows (a Memory's `rootSlices`); more, and the yes is stale. */
const LOOP_CITED_MAX = 128;

function loopCited(pattern: PatternResult, evidence: Map<string, Evidence>): string[] {
  return [...pattern.window.purchaseIds, ...pattern.meetingIds, ...pattern.receiptIds].filter((eid) => evidence.has(eid));
}

function loopMemory(ctx: RouteContext, at: string, epoch: number, policyRev: number, id: string, loop: LoopRecord, pattern: PatternResult, evidence: Map<string, Evidence>): Memory {
  const cited = loopCited(pattern, evidence);
  // Lineage (KC03): one root Slice per cited row, the row's first Slice with a range (checked by the caller).
  const rootSlices = cited.map((eid) => loopRootSlice(evidence.get(eid)!)!);
  return {
    ...cFields(ctx.uid, at, epoch, policyRev),
    rootSlices,
    rootKeys: rootSlices.map((x) => rootKey(x, ctx.deps.hasher)),
    dependsOn: cited.map((eid) => `e:${eid}`),
    logicalId: id,
    kind: "loop",
    subjectId: "self",
    predicate: "loop",
    scopeId: "global",
    key: ctx.deps.hasher.id(["loopKey", loop.predicateVersion, loop.baseline.fromCivil]),
    value: { kind: "none" },
    args: {},
    bindings: [],
    status: "active",
    sourceClass: "C",
    sens: "S1",
    closeReason: null,
    lastSupportAt: null,
    flow: "open",
    assertedAt: at,
    validFrom: at,
    validTo: null,
    validFromKey: at,
    validFromKnown: true,
    when: { kind: "none" },
    time: null,
    endWhen: { kind: "standing" },
    nextReviewAt: loop.checkAt,
    replacesIds: [],
    // The first 16 cited rows; the full lineage is in `rootSlices` and `dependsOn`.
    supportingIds: evidenceRefs(cited, evidence, 16),
    entityIds: [],
    topicIds: [],
    roleKeys: [],
    watchTokens: [],
    watches: [],
    anchorId: null,
    unboundStart: null,
    scheduleRev: 0,
    sayAs: null,
    texture: [],
    gravity: 0,
    closesId: null,
    possibleClosureSourceId: null,
    expectedArtifactId: null,
    embedding: null,
    vectorVersion: null,
    hypothesis: null,
    loop,
  };
}

/**
 * Brief 037, finding 4 (the binding). A yes acts only on the offer just presented: the offer was recorded as shown
 * (the `pendingRendered` receipt's ledger row for its pending ID) during this session, and the yes is the owner's
 * next turn after that record. Anything else is not a yes, and Franki may ask again. Fails closed.
 */
export const YES_LOOKBACK_TURNS = 32;

async function yesFollowsOffer(ctx: RouteContext, pendingId: string, turnId: string, turn: Turn): Promise<boolean> {
  const { uid, deps } = ctx;
  const shown = await deps.store.get<Ledger>(uid, paths.ledger(uid, renderedEntryId(deps.hasher, pendingId)));
  if (shown === null || shown.data.kind !== "decision") return false;
  const shownAt = Date.parse(shown.data.at);
  const session = await deps.store.get<Session>(uid, paths.session(uid, turn.sessionId));
  if (session === null || Date.parse(session.data.startedAt) > shownAt || Date.parse(turn.committedAt) < shownAt) return false;
  const rows = await deps.store.query<Turn>(uid, {
    collection: paths.turns(uid, turn.sessionId),
    where: [{ field: "seq", op: ">=", value: Math.max(0, turn.seq - YES_LOOKBACK_TURNS) }],
    orderBy: { field: "seq", dir: "asc" },
    limit: 100,
  });
  return !rows.some((r) => r.id !== turnId && r.data.role === "user" && r.data.seq <= turn.seq && Date.parse(r.data.committedAt) >= shownAt);
}


export async function answerTool(ctx: RouteContext, stamp: Stamp, args: AnswerArgs, turn: Turn): Promise<FoodOutcome> {
  const { uid, deps } = ctx;
  const answer = (state: "applied" | "declined" | "clarify" | "stale", receiptId: string | null = null, cards: Card[] = []): Result => ({ name: "answer", state, receiptId, pendingId: args.pendingId, cards });
  const only = (state: "declined" | "clarify" | "stale"): FoodOutcome => ({ result: answer(state), write: null });
  const rows = await readMoneyRows(ctx, stamp.generation, heroScope);
  const offer = rows === null ? null : offerFrom(ctx, rows);
  if (rows === null || offer === null || args.pendingId !== offer.pendingId) return only("stale");
  if (args.choiceId === offer.noId) return only("declined");
  // Code decides the owner said yes: the choice must be "yes", the owner's own words a plain yes, and the yes the
  // owner's next turn after the offer was shown.
  if (args.choiceId !== offer.yesId || turn.role !== "user" || turn.sourceClass !== "U" || !turn.final || !isPlainYes(turn.text)) return only("clarify");
  if (!(await yesFollowsOffer(ctx, offer.pendingId, stamp.turnId, turn))) return only("clarify");

  const planned = dinnersFor(await readRules(ctx));
  if (planned.candidates.length === 0) return only("clarify");
  const actionId = deps.hasher.id(["heroAction", offer.pendingId]);
  const loopId = deps.hasher.id(["heroLoop", offer.pendingId]);
  const loop = planHeroLoop(offer.pattern, rows.clock.worldClock.now, actionId);
  if (loop === null) return only("stale");
  const cited = loopCited(offer.pattern, rows.evidence);
  if (cited.length > LOOP_CITED_MAX || cited.some((eid) => loopRootSlice(rows.evidence.get(eid)!) === null)) return only("stale");
  const card = foodCard(ctx, planned.candidates, "Three quick dinners for those nights");
  const pickedIds = planned.candidates.map((c) => c.id).join("|");

  const write: FoodWrite = async (tx, rules) => {
    if (rules.rulesRev !== stamp.rulesRev) return null;
    const dinners = dinnersFor(foodRulesOf(rules));
    if (dinners.candidates.map((c) => c.id).join("|") !== pickedIds) return null;
    if ((await tx.get(paths.ledger(uid, actionId))) !== null) return () => undefined;
    const at = tsFromMs(deps.clock.read().opsClock.now);
    const entry: ActionEntry = {
      ...cFields(uid, at, stamp.epoch, stamp.policyRev),
      kind: "action",
      state: "complete",
      at,
      retainUntil: null,
      payload: {
        pendingId: offer.pendingId,
        executor: "makeList",
        time: null,
        note: null,
        items: groceryItems(dinners.candidates).map((label) => ({ id: deps.hasher.id(["grocery", actionId, label]), label, state: "open" as const })),
        externalReceipt: null,
        loopId,
      },
    };
    const memory = loopMemory(ctx, tsFromMs(rows.clock.worldClock.now), stamp.epoch, stamp.policyRev, loopId, loop, offer.pattern, rows.evidence);
    return () => {
      tx.create(paths.ledger(uid, actionId), entry);
      tx.create(paths.memory(uid, loopId), memory);
      deps.log("tool.heroYes", { actionId, loopId });
    };
  };
  return { result: answer("applied", actionId, [card]), write };
}

// ---------------------------------------------------------------------------------------------
// The comparison

export interface LoopComparison {
  loopId: string;
  loop: LoopRecord;
  takeout: LoopResult;
  totalFood: LoopResult;
  /** The words, only for a closed loop with a good outcome; a miss stays silent. */
  lines: string[] | null;
}

/** Compares the loop's equal windows from rows now, or null when the loop or its rows can't be read. */
export async function compareLoop(ctx: RouteContext, loopId: string, generation: number): Promise<LoopComparison | null> {
  const doc = await ctx.deps.store.get<Memory>(ctx.uid, paths.memory(ctx.uid, loopId));
  if (doc === null || doc.data.loop === null || doc.data.status !== "active") return null;
  const loop = doc.data.loop;
  // Both windows, every food category the comparison reads (brief 037, finding 6).
  const scope: MoneyScope = { fromCivil: loop.baseline.fromCivil, toCivil: loop.comparison.toCivil, categories: [...new Set([...METRIC_CATEGORIES.takeoutSpend, ...METRIC_CATEGORIES.totalFoodSpend])], meetings: false };
  const rows = await readMoneyRows(ctx, generation, () => scope);
  if (rows === null) return null;
  const input = { loop, purchases: rows.bank, receipts: rows.receipts, bankCoverage: rows.coverage, worldNow: rows.clock.worldClock.now };
  const takeout = loopPredicate(input);
  const totalFood = loopPredicate({ ...input, metric: "totalFoodSpend" });
  return { loopId, loop, takeout, totalFood, lines: celebration(loop, takeout, totalFood)?.lines ?? null };
}
