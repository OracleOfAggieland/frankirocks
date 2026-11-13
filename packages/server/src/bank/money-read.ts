/**
 * Brief 046 part C: `read_money`, the server half. Read-only: it never writes a row of its own (a stale bank's pull is
 * the pull's own write, ruling 7).
 *
 *   1. Whose question: the owner's own committed turn (class U, final, with words). Anything else answers one S0 line.
 *   2. Which banks: `readableBankIds` (ruling 9). None: one S0 line and the connect card, never the persona's rows.
 *   3. Freshness: `pullIfStale` on each bank, all under one deadline taken from the caller's budget. A late or failed
 *      pull answers from what is stored and says how old it is.
 *   4. Which rows: `source: "plaid"` rows of those banks, the newest revision of each logical row only, not removed,
 *      each through `eligible()` with the forget snapshot at stage `toolReturn` (as `readMoneyRows` in tool-food.ts).
 *   5. The answer: `moneyAnswer` in core, in integer cents; its lines are worded by code and the model may only word
 *      them again. Each part's note cites exactly the rows behind it.
 *
 * Every amount is S1; the Gate decides in the admission transaction (money-gate.ts), never here.
 */
import {
  type Card,
  type ClockPair,
  type Connector,
  type Evidence,
  type ID,
  type MoneyArgs,
  type MoneyFacts,
  type MoneyRow,
  type Snapshot,
  type Turn,
  type W,
  MONEY_LINES,
  MONEY_NO_BANK_CARD,
  civilDateAt,
  docRef,
  eligible,
  freshnessLine,
  moneyAnswer,
  moneyPeriod,
  msFromTs,
  partLine,
  rootKey,
  tsFromMs,
  type ToolResult,
  type Infer,
} from "@franki/core";
import { withDeadline } from "../clock/timers";
import { ownerClock, readCoreDocs } from "../core-docs";
import { forgetRowsFor } from "../forget/snapshot-rows";
import { foregroundEC, storeReader } from "../head-build";
import { loopRootSlice } from "../routes/tool-food";
import type { RouteContext } from "../routes/runtime";
import { NOTE_TTL_MS } from "../routes/typed-reply";
import { paths } from "../store/paths";
import type { Reader, StoredDoc } from "../store/port";
import { listConnectors } from "./connector";
import { pullIfStale } from "./pull";
import { bankRuntime, readableBankIds } from "./routes";
import { storedCategoryCode } from "./rows";

export type MoneyResult = Extract<Infer<typeof ToolResult>, { name: "read_money" }>;

/** Time kept back from the caller's deadline for the read and the answer after the pulls. */
export const MONEY_READ_RESERVE_MS = 1_200;
/** Below this, no pull is started: the answer comes from what is stored. */
export const MONEY_PULL_MIN_MS = 250;
/** Evidence is scanned by document ID (Q28); past this many documents the read answers `narrow` (fails closed). */
export const MONEY_SCAN_MAX = 50_000;
/** The forget snapshot holds at most this many rows (`Snapshot.refs`), so the rows in scope must fit beside it. */
const SNAPSHOT_ROWS_MAX = 4096;

export interface MoneyReadOut {
  result: MoneyResult;
  /** The computed answer, for tests and lineage checks; null when no total was computed. */
  facts: MoneyFacts | null;
}

export interface MoneyReadInput {
  turn: Turn;
  args: MoneyArgs;
  generation: number;
  /** The opsClock time by which the read must have answered. */
  deadlineAt: number;
  /** The note ID of part `n` (and of a single line, n = 0). */
  noteId: (n: number) => ID;
}

/** The owner's own committed words this turn, or null (class U, final, committed, with words). */
export function ownersWords(turn: Turn): string | null {
  if (turn.role !== "user" || turn.sourceClass !== "U" || !turn.final || turn.parseState !== "committed") return null;
  return turn.text !== null && turn.text.trim() !== "" ? turn.text : null;
}

function lineNote(ctx: RouteContext, noteId: (n: number) => ID, text: string): W {
  return {
    noteId: noteId(0),
    rev: 1,
    kind: "result",
    text,
    rootKeys: [],
    dependsOn: [],
    sens: "S0",
    expiresAt: tsFromMs(ctx.deps.clock.read().opsClock.now + NOTE_TTL_MS),
    unprompted: false,
    momentId: null,
    tokens: [],
  };
}

/** An answer with no amount: one S0 line, and the connect card when no bank is connected. */
export function moneyLineResult(ctx: RouteContext, x: Pick<MoneyReadInput, "noteId">, state: MoneyResult["state"], text: string): MoneyResult {
  const cards: Card[] =
    state === "noBank" ? [{ id: x.noteId(9), kind: "source", title: MONEY_NO_BANK_CARD.title, lines: [...MONEY_NO_BANK_CARD.lines], sources: [], sens: "S0" }] : [];
  return { name: "read_money", state, notes: [lineNote(ctx, x.noteId, text)], cards };
}

async function scanBankEvidence(reader: Reader, uid: string, banks: ReadonlySet<string>): Promise<StoredDoc<Evidence>[] | null> {
  const out: StoredDoc<Evidence>[] = [];
  let cursor: string | null = null;
  let seen = 0;
  for (;;) {
    const page: StoredDoc<Evidence>[] = await reader.query<Evidence>({
      collection: paths.collection(uid, "evidence"),
      where: cursor === null ? [] : [{ field: "__name__", op: ">", value: cursor }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: 100,
    });
    seen += page.length;
    if (seen > MONEY_SCAN_MAX) return null;
    for (const d of page) {
      const e = d.data;
      if (e.source === "plaid" && e.kind === "transaction" && e.observation.kind === "bank" && e.connectorId !== null && banks.has(e.connectorId)) out.push(d);
    }
    if (page.length < 100) return out;
    cursor = page[page.length - 1]!.id;
  }
}

/** The newest revision of each logical row: the one no other stored revision names as its `revisionOf`. */
export function newestRevisions(docs: readonly StoredDoc<Evidence>[]): StoredDoc<Evidence>[] {
  const superseded = new Set(docs.map((d) => d.data.revisionOf).filter((x): x is string => x !== null));
  return docs.filter((d) => !superseded.has(d.id) && d.data.isCurrentProvider);
}

/** The row's civil date: the provider's day when set, else its authorized instant's day in the owner's zone. */
function dayOf(e: Evidence, zone: string): string | null {
  if (e.observation.kind !== "bank") return null;
  const p = e.observation.purchaseAt;
  if (p.civilDate !== null) return p.civilDate;
  if (p.instant !== null) return civilDateAt(msFromTs(p.instant), zone);
  return null;
}

/** Pulls every stale bank under one deadline; a failure or a late pull is logged and the stored rows answer. */
async function freshen(ctx: RouteContext, banks: readonly string[], deadlineAt: number): Promise<void> {
  const budget = deadlineAt - MONEY_READ_RESERVE_MS - ctx.deps.clock.read().opsClock.now;
  if (budget < MONEY_PULL_MIN_MS || banks.length === 0) return;
  let rt: ReturnType<typeof bankRuntime>;
  try {
    rt = bankRuntime(ctx);
  } catch {
    ctx.deps.log("money.pullSkipped", { why: "config" });
    return;
  }
  const pulls = banks.map((id) =>
    pullIfStale(ctx, id, rt).catch(() => {
      ctx.deps.log("money.pullFailed", {});
    }),
  );
  try {
    await withDeadline(Promise.all(pulls), budget, ctx.deps.timers);
  } catch {
    ctx.deps.log("money.pullLate", {});
  }
}

/** The read. Never throws for a bank problem: the stored rows answer, or a line with no amount. */
export async function readMoney(ctx: RouteContext, x: MoneyReadInput): Promise<MoneyReadOut> {
  const { uid, deps } = ctx;
  const line = (state: MoneyResult["state"], text: string): MoneyReadOut => ({ result: moneyLineResult(ctx, x, state, text), facts: null });
  const words = ownersWords(x.turn);
  if (words === null) return line("held", MONEY_LINES.notAsked);

  const readable = await readableBankIds(ctx);
  if (readable.size === 0) return line("noBank", MONEY_LINES.noBank);
  await freshen(ctx, [...readable].sort(), x.deadlineAt);

  const reader = storeReader(deps.store, uid);
  // Read again after the pulls: a pull may have found the bank revoked (then it is not readable any more).
  const banks = await readableBankIds(ctx);
  if (banks.size === 0) return line("noBank", MONEY_LINES.noBank);
  const connectors = (await listConnectors(reader, uid)).filter((c) => banks.has(c.id)).map((c) => c.data);
  const core = await readCoreDocs(reader, uid);
  const pair = ownerClock(core.state.data, deps.clock);
  // Ruling 10: the bank's rows are facts in real time, so "this month" is the ops clock's month in the owner's zone.
  const now = pair.opsClock.now;
  const zone = core.state.data.currentZone;

  const scanned = await scanBankEvidence(reader, uid, banks);
  if (scanned === null) return line("narrow", MONEY_LINES.narrow);
  const range = moneyPeriod(x.args.period, now, zone);
  const current = newestRevisions(scanned).filter((d) => {
    if (d.data.observation.kind !== "bank" || d.data.observation.removed) return false;
    const day = dayOf(d.data, zone);
    return day === null || (day >= range.from && day <= range.to);
  });
  if (scanned.length === 0 && connectors.some((c) => c.lastSuccessAt === null || !c.bank!.historicalComplete)) return line("importing", MONEY_LINES.importing);

  const forget = await forgetRowsFor(reader, uid);
  const refs = [...current.map((d) => docRef("evidence", d.id, d.data.rev)), ...forget.refs];
  if (refs.length > SNAPSHOT_ROWS_MAX) return line("narrow", MONEY_LINES.narrow);
  const snapshot: Snapshot = {
    uid,
    epoch: core.epoch.data,
    session: null,
    job: null,
    localGeneration: x.generation,
    refs,
    rows: [...current.map((d) => d.data), ...forget.rows],
    blocks: forget.blocks,
    coverage: core.state.data.coverage,
    complete: forget.complete,
  };
  const clock: ClockPair = pair;
  const ec = { ...foregroundEC(uid, core.epoch.data, clock, x.generation), stage: "toolReturn" as const };
  const rows: MoneyRow[] = [];
  for (const d of current) {
    const e = d.data;
    if (e.observation.kind !== "bank") continue;
    if (!eligible({ ref: docRef("evidence", d.id, e.rev), row: e }, ec, snapshot).allow) continue;
    const root = loopRootSlice(e);
    if (root === null) continue;
    rows.push({
      eid: d.id,
      rootKey: rootKey(root, deps.hasher),
      title: e.title ?? "",
      merchantKey: e.observation.merchantKey,
      amountCents: e.observation.amountCents,
      currency: e.observation.currency,
      pending: e.observation.pending,
      code: storedCategoryCode(e),
      day: dayOf(e, zone),
    });
  }

  const facts = moneyAnswer(rows, { period: x.args.period, group: x.args.group, merchant: x.args.merchant }, now, zone, words);
  if (facts.kind === "unclear") return line("unclear", MONEY_LINES.unclear);
  if (facts.kind === "narrow") return line("narrow", MONEY_LINES.narrow);

  // How fresh: the oldest last read among the banks answered from; a bank still importing says so.
  const lasts = connectors.map((c) => (c.lastSuccessAt === null ? null : msFromTs(c.lastSuccessAt)));
  const oldest = lasts.some((l) => l === null) ? null : Math.min(...(lasts as number[]));
  const extra = [freshnessLine(oldest, now)];
  if (connectors.some((c: Connector) => !c.bank!.historicalComplete)) extra.push("The bank is still importing older purchases, so some may be missing.");
  const expiresAt = tsFromMs(now + NOTE_TTL_MS);
  const notes: W[] = facts.parts.map((p, i) => ({
    noteId: x.noteId(i),
    rev: 1,
    kind: "result",
    text: partLine(p, i === 0 ? extra : []),
    rootKeys: [...new Set(p.cited.map((c) => c.rootKey))] as ID[],
    dependsOn: p.cited.map((c) => `e:${c.eid}`),
    sens: "S1",
    expiresAt,
    unprompted: false,
    momentId: null,
    tokens: [],
  }));
  return { result: { name: "read_money", state: "answered", notes, cards: [] }, facts };
}

/** The Server_Rule's S0 limit for a money result: any note above S0 holds the whole answer behind one S0 line. */
export function limitMoneyToS0(ctx: RouteContext, stamp: { sessionId: string; turnId: string }, result: MoneyResult): MoneyResult {
  if (result.notes.every((n) => n.sens === "S0")) return result;
  const noteId = () => ctx.deps.hasher.id(["money-held", stamp.sessionId, stamp.turnId]) as ID;
  return { ...moneyLineResult(ctx, { noteId }, "held", MONEY_LINES.held), cards: [] };
}
