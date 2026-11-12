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
  type Cov,
  type Evidence,
  type FoodCandidate,
  type Infer,
  type Ledger,
  type LoopRecord,
  type LoopResult,
  type Memory,
  type PatternResult,
  type Ref,
  type Snapshot,
  type Stamp,
  type ToolCall,
  type ToolResult,
  type Turn,
  type BankRow,
  type MeetingRow,
  type ReceiptRow,
  CATALOG_VERSION,
  addCivilDays,
  celebration,
  civilDateAt,
  docRef,
  eligible,
  formatDollars,
  groceryItems,
  heroOfferLine,
  heroOfferParts,
  heroWindow,
  ingredient,
  isPlainYes,
  loopPredicate,
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
import type { Reader } from "../store/port";
import { paths } from "../store/paths";
import type { RouteContext } from "./runtime";

type Result = Infer<typeof ToolResult>;
type SuggestArgs = Extract<ToolCall, { name: "suggest" }>["args"];
type AnswerArgs = Extract<ToolCall, { name: "answer" }>["args"];

/** The hero's currency. Rows in any other currency are excluded, never converted. */
export const HERO_CURRENCY = "USD";
/** Evidence is read by document ID (Q28; no index by kind exists). More than this many and the hero says nothing. */
export const EVIDENCE_SCAN_MAX = 2_000;
/** At most this many rows of each kind go to the detector (contracts: Purchase[<=128], CalendarEvent[<=128]). */
export const MONEY_ROWS_MAX = 128;

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

/** The eligible bank, receipt and calendar rows, or null when they can't all be read (fails closed). */
async function readMoneyRows(ctx: RouteContext, generation: number): Promise<MoneyRows | null> {
  const { uid, deps } = ctx;
  const reader = storeReader(deps.store, uid);
  const core = await readCoreDocs(reader, uid);
  const clock = ownerClock(core.state.data, deps.clock);
  const docs = await scanEvidence(reader, uid);
  if (docs === null) return null;
  const money = docs.filter((d) => ["transaction", "receipt", "calendar"].includes(d.data.kind));
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
  const anchor = await heroAnchor(reader, uid, deps.hasher, clock.worldClock.now);
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

function patternFor(rows: MoneyRows): PatternResult {
  const zone = rows.clock.worldClock.zone;
  // Brief 030 P1-1: a live insight keeps its own window across a jump; heroWindow ends the day before `today`.
  const today = rows.anchor !== null ? addCivilDays(rows.anchor, 1) : civilDateAt(rows.clock.worldClock.now, zone);
  return takeoutLateMeetingV1({
    purchases: rows.bank,
    receipts: rows.receipts,
    events: rows.events,
    // One coverage for both until connectors keep their own (design note 022, gap 13).
    bankCoverage: rows.coverage,
    calendarCoverage: rows.coverage,
    window: heroWindow(today, zone, HERO_CURRENCY),
  });
}

function offerFrom(ctx: RouteContext, rows: MoneyRows): HeroOffer | null {
  const pattern = patternFor(rows);
  const line = heroOfferLine(pattern);
  ctx.deps.log("tool.heroPattern", { status: pattern.status, mostly: pattern.mostly, orders: pattern.orderCount, coveredDates: pattern.coveredDates, rows: rows.bank.length, events: rows.events.length, late: pattern.lateOrderCount });
  if (line === null) return null;
  const pendingId = ctx.deps.hasher.id(heroOfferParts(pattern));
  const w = pattern.window;
  const unit = pattern.associationUnit === "night" ? "nights" : "days";
  const card: Card = {
    id: ctx.deps.hasher.id(["heroOfferCard", pendingId]),
    kind: "source",
    title: "Takeout and late meetings",
    lines: [
      `${formatDollars(pattern.totalCents)} on takeout, ${pattern.orderCount} orders, ${w.fromCivil} to ${w.toCivil}`,
      `${formatDollars(pattern.lateCents)} of it in ${pattern.lateOrderCount} orders on ${unit} with meetings after 6`,
      "A pattern in your own records, not a cause",
    ],
    sources: evidenceRefs([...w.purchaseIds, ...pattern.meetingIds, ...pattern.receiptIds], rows.evidence, 32),
    sens: "S1",
  };
  return { pattern, pendingId, yesId: ctx.deps.hasher.id(["heroOfferChoice", pendingId, "yes"]), noId: ctx.deps.hasher.id(["heroOfferChoice", pendingId, "no"]), line, card };
}

/** The hero offer now, or null when the pattern doesn't hold (or its rows can't all be read). */
export async function heroOffer(ctx: RouteContext, generation: number): Promise<HeroOffer | null> {
  const rows = await readMoneyRows(ctx, generation);
  return rows === null ? null : offerFrom(ctx, rows);
}

// ---------------------------------------------------------------------------------------------
// suggest(food)

async function readRules(ctx: RouteContext) {
  try {
    const core = await readCoreDocs(storeReader(ctx.deps.store, ctx.uid), ctx.uid);
    return core.rules.data.allergies;
  } catch {
    return null;
  }
}

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

export async function suggestTool(ctx: RouteContext, _stamp: Stamp, args: SuggestArgs): Promise<Result> {
  if (args.domain !== "food") {
    return { name: "suggest", candidateIds: [], selectedId: null, reason: "", pendingId: null, question: null, coverage: UNKNOWN_COV, cards: [] };
  }
  const rules = await readRules(ctx);
  const out = suggestFood({ rules, attendeeIds: args.attendeeIds });
  ctx.deps.log("tool.suggest", { kept: out.filter.kept.length, removed: out.filter.removed.length, picked: out.candidates.length });
  return {
    name: "suggest",
    candidateIds: out.candidates.map((c) => candidateId(ctx, c)),
    selectedId: out.selectedId === null ? null : candidateId(ctx, out.candidates[0]!),
    reason: out.reason?.text ?? "",
    pendingId: null,
    question: out.question,
    coverage: rules === null ? UNKNOWN_COV : COMPLETE_COV,
    cards: out.candidates.length === 0 ? [] : [foodCard(ctx, out.candidates, "Quick dinners")],
  };
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

function loopCited(pattern: PatternResult, evidence: Map<string, Evidence>): string[] {
  return [...pattern.window.purchaseIds, ...pattern.meetingIds, ...pattern.receiptIds].filter((eid) => evidence.has(eid)).slice(0, 128);
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

export async function answerTool(ctx: RouteContext, stamp: Stamp, args: AnswerArgs, turn: Turn): Promise<Result> {
  const { uid, deps } = ctx;
  const answer = (state: "applied" | "declined" | "clarify" | "stale", receiptId: string | null = null, cards: Card[] = []): Result => ({ name: "answer", state, receiptId, pendingId: args.pendingId, cards });
  const rows = await readMoneyRows(ctx, stamp.generation);
  const offer = rows === null ? null : offerFrom(ctx, rows);
  if (rows === null || offer === null || args.pendingId !== offer.pendingId) return answer("stale");
  if (args.choiceId === offer.noId) return answer("declined");
  // Code decides the owner said yes: the choice must be "yes" and the owner's own words a plain yes.
  if (args.choiceId !== offer.yesId || turn.role !== "user" || turn.sourceClass !== "U" || !turn.final || !isPlainYes(turn.text)) return answer("clarify");

  const dinners = suggestFood({ rules: await readRules(ctx), attendeeIds: [] });
  if (dinners.candidates.length === 0) return answer("clarify");
  const actionId = deps.hasher.id(["heroAction", offer.pendingId]);
  const loopId = deps.hasher.id(["heroLoop", offer.pendingId]);
  const loop = planHeroLoop(offer.pattern, rows.clock.worldClock.now, actionId);
  if (loop === null) return answer("stale");
  if (loopCited(offer.pattern, rows.evidence).some((eid) => loopRootSlice(rows.evidence.get(eid)!) === null)) return answer("stale");
  const card = foodCard(ctx, dinners.candidates, "Three quick dinners for those nights");

  await deps.store.transaction(uid, async (tx) => {
    const path = paths.ledger(uid, actionId);
    if ((await tx.get(path)) !== null) return;
    const core = await readCoreDocs(tx, uid);
    const at = tsFromMs(deps.clock.read().opsClock.now);
    const { epoch, policyRev } = core.epoch.data;
    const entry: ActionEntry = {
      ...cFields(uid, at, epoch, policyRev),
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
    tx.create(path, entry);
    tx.create(paths.memory(uid, loopId), loopMemory(ctx, tsFromMs(rows.clock.worldClock.now), epoch, policyRev, loopId, loop, offer.pattern, rows.evidence));
  });
  deps.log("tool.heroYes", { actionId, loopId });
  return answer("applied", actionId, [card]);
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
  const rows = await readMoneyRows(ctx, generation);
  if (rows === null) return null;
  const loop = doc.data.loop;
  const input = { loop, purchases: rows.bank, receipts: rows.receipts, bankCoverage: rows.coverage, worldNow: rows.clock.worldClock.now };
  const takeout = loopPredicate(input);
  const totalFood = loopPredicate({ ...input, metric: "totalFoodSpend" });
  return { loopId, loop, takeout, totalFood, lines: celebration(loop, takeout, totalFood)?.lines ?? null };
}
