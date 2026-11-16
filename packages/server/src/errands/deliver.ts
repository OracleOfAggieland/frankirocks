/**
 * Brief 049 part A, rulings 4, 7, 9, 10, 11, 12 and 14, with the review fixes: what the state poll does with this
 * Session's Errands. One call from `routes/state.ts`, after its own transaction has committed, inside what is left
 * of its budget (review fix R1); out of budget it says nothing and the screen keeps what it has (`view: null`).
 *
 *   1. One read by name: the Session's mark (`errandMarks/{sessionId}`, review fix R1). No mark, or one past its
 *      `openUntil`: nothing more is read, and no query runs. Otherwise the Errands it names, read by ID together.
 *   2. Upkeep, each in its own small transaction: an Errand claimed before the current epoch is `dropped`; a waiting
 *      result nobody heard within `ERRAND_RESULT_TTL_MS` goes `cardOnly`; a row past its `retainUntil` is stripped
 *      bare (review fix R12); a running Errand whose Job's lease lapsed, or that never started, gets a runner.
 *   3. The view (rulings 11, 12): what this Session's running Errands look through, and the cards of its own
 *      delivered or card-only results (review fix V5: never another Session's) from the last `ERRAND_CARD_KEEP_MS`,
 *      gated for the audience now from the Gate inputs stored at `finish`; outside private only S0 lines from no
 *      third party show. Every outcome has a card: a `failed` or `nothing` result is one S0 line (review fix R8). In
 *      crisis nothing is said or shown (review fix V7).
 *   4. Delivery (ruling 9; review fixes V2, V4): only in a call, only when the route's own checks passed, only after
 *      `ERRAND_SILENCE_MS` of quiet, for the oldest waiting result of this Session with no offer out. The claim is
 *      one transaction that rereads the Errand, the Session and the core: the Session active on the same generation
 *      with a call, not narrowed here; the Stamp still current; the epoch unchanged and no barrier. It recomputes the
 *      audience and the Gate there, writes the Gate rows of every line not said, records the offer on the Errand
 *      (attempt n, `ERRAND_OFFER_MS`) and has the Admission_Seam write that attempt's decision row. The Errand stays
 *      waiting: it is `delivered` on the browser's receipt (`errands/receipt.ts`), and offered again only after the
 *      offer expired with no receipt, until its five minutes end.
 *
 * Fails closed: any failure here says nothing and shows nothing, and never fails the poll.
 */
import {
  type Au,
  ERRAND_CARD_KEEP_MS,
  ERRAND_FOUND_LEAD,
  ERRAND_HELD_LINE,
  ERRAND_OFFER_MS,
  ERRAND_ON_SCREEN_LINE,
  ERRAND_REST_ON_SCREEN_LINE,
  ERRAND_RESULT_TTL_MS,
  ERRAND_SILENCE_MS,
  type Card,
  type Connector,
  type Errand,
  type ErrandAbout,
  type ErrandMark,
  type ErrandsView,
  type ID,
  type Job,
  type Proactive,
  type SS,
  type Sens,
  type Session,
  type W,
  aboutPhrase,
  errandFailedLine,
  errandNothingLine,
  errandNoticeLine,
  errandNoticeSens,
  errandWaiting,
  msFromTs,
  nextErrandStatus,
  tsFromMs,
} from "@franki/core";
import { admitErrandLine } from "../admission/seam";
import { gateAudience } from "../audience";
import { narrowedHere } from "../audience-swap";
import { withDeadline } from "../clock/timers";
import { ownerClock, readCoreDocs } from "../core-docs";
import { currentStamp } from "../deck";
import { writeGateDecision } from "../ledger/said";
import type { RouteContext } from "../routes/runtime";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import type { StoredDoc } from "../store/port";
import type { ProactiveDeck } from "../time/proactive";
import type { SpecialistCatalog } from "@franki/core";
import { specialistCatalog } from "./agent";
import { cardShows, errandCard, sourceLine } from "./card";
import { type LineVerdict, gateErrandLines } from "./gate";
import { errandDeliveryId } from "./records";
import { runErrand } from "./run";

export const NO_ERRANDS: ErrandsView = { running: [], cards: [], ready: false };
/** Cards one poll shows at most (the wire's bound). */
export const ERRAND_CARDS_MAX = 4;

export interface ErrandStateInput {
  sessionId: ID;
  /** The Session as the state route left it. */
  session: Session;
  /** The current stamp, without a turn. */
  stamp: SS;
  deck: ProactiveDeck | null;
  /** The route's own checks passed: a StateAck was issued and a Deck goes out. */
  mayOffer: boolean;
  /** Review fix R1: what is left of the poll's budget; none left, nothing is read. */
  budgetMs?: number;
}

/** `view: null`: nothing was read (out of budget, or a failure), so the screen keeps what it shows. */
export interface ErrandStateOutput {
  specialists?: SpecialistCatalog;
  view: ErrandsView | null;
  proactive: Proactive | null;
}

/** The view and, at most, one line to say. Never throws. */
export async function errandsOnState(ctx: RouteContext, x: ErrandStateInput): Promise<ErrandStateOutput> {
  if (x.budgetMs !== undefined && x.budgetMs <= 0) return { view: null, proactive: null };
  try {
    const work = errandsOnce(ctx, x);
    return x.budgetMs === undefined ? await work : await withDeadline(work, x.budgetMs, ctx.deps.timers);
  } catch (e) {
    ctx.deps.log("errand.state", { error: e instanceof Error ? e.name : "unknown" });
    return { view: null, proactive: null };
  }
}

/** The Session's Errands by its mark, or null when the Session has nothing open (no query either way). */
async function markedErrands(ctx: RouteContext, sessionId: string, ops: number): Promise<StoredDoc<Errand>[] | null> {
  const { uid, deps } = ctx;
  const mark = (await deps.store.get<ErrandMark>(uid, paths.errandMark(uid, sessionId)))?.data ?? null;
  if (mark === null || msFromTs(mark.openUntil) <= ops) return null;
  const rows = await Promise.all(mark.errandIds.map((id) => deps.store.get<Errand>(uid, paths.errand(uid, id))));
  return rows.filter((r): r is StoredDoc<Errand> => r !== null && r.data.sessionId === sessionId).sort((a, b) => msFromTs(b.data.startedAt) - msFromTs(a.data.startedAt));
}

const hasContent = (e: Errand) => e.lines.length > 0 || e.reads.length > 0 || e.gate !== null || e.offer !== null;

async function errandsOnce(ctx: RouteContext, x: ErrandStateInput): Promise<ErrandStateOutput> {
  const ops = ctx.deps.clock.read().opsClock.now;
  // Review fix R2: the agents' readiness, beside the Session's mark.
  const [rows, specialists] = await Promise.all([markedErrands(ctx, x.sessionId, ops), specialistCatalog(ctx)]);
  const ready = specialists.mail === "ready" || specialists.calendar === "ready";
  return { ...await errandView(ctx, x, rows, ready, ops), specialists };
}

async function errandView(ctx: RouteContext, x: ErrandStateInput, rows: StoredDoc<Errand>[] | null, ready: boolean, ops: number): Promise<ErrandStateOutput> {
  const { uid, deps } = ctx;
  if (rows === null || rows.length === 0) return { view: { ...NO_ERRANDS, ready }, proactive: null };
  const epoch = x.stamp.epoch;
  const live: StoredDoc<Errand>[] = [];
  for (const r of rows) {
    const e = r.data;
    if (e.status === "dropped") continue;
    if (e.claimedEpoch !== epoch) {
      await move(ctx, r.id as ID, "forget");
      continue;
    }
    if (errandWaiting(e.status) && e.readyAt !== null && msFromTs(e.readyAt) + ERRAND_RESULT_TTL_MS <= ops) {
      const moved = await move(ctx, r.id as ID, "expired");
      if (moved !== null) live.push({ ...r, data: moved });
      continue;
    }
    if (e.status !== "running" && e.retainUntil !== null && msFromTs(e.retainUntil) <= ops) {
      if (hasContent(e)) await move(ctx, r.id as ID, "strip");
      continue;
    }
    // Review fix T10: a result whose connector was disconnected, expired or moved to another account is dropped.
    if (e.status !== "running" && !(await connectorsReadable(ctx, e))) {
      await move(ctx, r.id as ID, "forget");
      continue;
    }
    if (e.status === "running") await pickUp(ctx, r.id as ID);
    live.push(r);
  }

  const { audience, modifiers } = gateAudience(x.session, ops);
  const running = new Set<ErrandAbout>();
  for (const r of live) if (r.data.status === "running") for (const a of r.data.about) running.add(a);
  // Review fix V7: in crisis an Errand says nothing and shows nothing; the running word is S0 and stays.
  if (modifiers.crisis) return { view: { running: [...running], cards: [], ready }, proactive: null };

  const clock = ownerClock((await deps.store.get(uid, paths.core(uid, "state")))!.data as never, deps.clock).worldClock;
  const verdictsOf = (e: Errand, id: ID, au: Au, mods: typeof modifiers): LineVerdict[] =>
    gateErrandLines({ errand: e, inputs: e.gate, audience: au, modifiers: mods, worldNow: clock.now, zone: clock.zone, candidateId: (i) => deps.hasher.id(["errandLine", id, i]) as ID });
  const cardOf = (e: Errand, id: ID, au: Au, mods: typeof modifiers) => errandResultCard(e, verdictsOf(e, id, au, mods), au, { id: deps.hasher.id(["errandCard", id]) as ID, zone: clock.zone });

  const cards: Card[] = [];
  for (const r of live) {
    const e = r.data;
    if (cards.length >= ERRAND_CARDS_MAX) break;
    if ((e.status !== "delivered" && e.status !== "cardOnly") || e.readyAt === null || msFromTs(e.readyAt) + ERRAND_CARD_KEEP_MS <= ops) continue;
    const card = cardOf(e, r.id as ID, audience, modifiers);
    if (card !== null) cards.push(card);
  }
  const view: ErrandsView = { running: [...running], cards, ready };

  if (!x.mayOffer || x.deck === null || x.session.registeredCallIds.length === 0) return { view, proactive: null };
  const lastSound = Math.max(msFromTs(x.session.lastTurnAt), x.session.lastSpeechStartedOpsAt === null ? 0 : msFromTs(x.session.lastSpeechStartedOpsAt));
  if (!(ops - lastSound >= ERRAND_SILENCE_MS)) return { view, proactive: null };
  const due = live
    .filter((r) => errandWaiting(r.data.status) && r.data.readyAt !== null && (r.data.offer === null || msFromTs(r.data.offer.expiresAt) <= ops))
    .sort((a, b) => msFromTs(a.data.readyAt!) - msFromTs(b.data.readyAt!))[0];
  if (due === undefined) return { view, proactive: null };
  const claimed = await claimDelivery(ctx, x, due.id as ID, due.data, (e, au, mods) => verdictsOf(e, due.id as ID, au, mods));
  if (claimed === null) return { view, proactive: null };
  // The card of a result just offered goes out with it, not a poll later (ruling 11).
  const card = cards.length >= ERRAND_CARDS_MAX ? null : cardOf(claimed.errand, due.id as ID, claimed.audience, claimed.modifiers);
  return { view: card === null ? view : { ...view, cards: [card, ...cards] }, proactive: claimed.proactive };
}

/** Review fix T10: every connector the Errand's reads came from is still connected, on the same account generation. */
export async function connectorsReadable(ctx: RouteContext, e: Pick<Errand, "connectors">): Promise<boolean> {
  if (e.connectors.length === 0) return true;
  const docs = await Promise.all(e.connectors.map((c) => ctx.deps.store.get<Connector>(ctx.uid, paths.connector(ctx.uid, c.id))));
  return e.connectors.every((c, i) => {
    const d = docs[i]?.data ?? null;
    return d !== null && d.state === "connected" && d.activeGeneration === c.generation;
  });
}

/** Review fix T8: the unmailed senders' messages a notice card lists, by address and date. */
const UNMAILED_CARD_MAX = 6;

/**
 * Review fix R8: a `failed` or `nothing` result's card is its one S0 line; others are their gated lines. Review fix
 * T8: a notice is its code line; the `unmailed` notice lists each stranger's address and date, in private only.
 */
export function errandResultCard(e: Errand, verdicts: readonly LineVerdict[], audience: Au, x: { id: ID; zone: string }): Card | null {
  if (e.notice !== null && e.lines.length === 0) {
    const title = `From ${aboutPhrase(e.about)}`;
    if (e.notice === "unmailed") {
      if (audience !== "private") return { id: x.id, kind: "source", title, lines: [ERRAND_HELD_LINE], sources: [], sens: "S0" };
      const strangers = e.reads.filter((r) => r.source.kind === "mail" && r.sender !== null && !r.sender.mailed).slice(0, UNMAILED_CARD_MAX);
      const lines = [errandNoticeLine("unmailed", e.about), ...strangers.map((r) => sourceLine(r.source, x.zone, r.sender))];
      return { id: x.id, kind: "source", title, lines, sources: strangers.map((r) => ({ type: "evidence" as const, id: r.evidenceId, rev: r.rev })), sens: errandNoticeSens("unmailed") };
    }
    return { id: x.id, kind: "source", title, lines: [errandNoticeLine(e.notice, e.about)], sources: [], sens: "S0" };
  }
  if (e.outcome === "failed" || e.outcome === null) return { id: x.id, kind: "source", title: `From ${aboutPhrase(e.about)}`, lines: [errandFailedLine(e.about)], sources: [], sens: "S0" };
  if (e.outcome === "nothing" || e.lines.length === 0) return { id: x.id, kind: "source", title: `From ${aboutPhrase(e.about)}`, lines: [errandNothingLine(e.about)], sources: [], sens: "S0" };
  return errandCard(e, verdicts, { ...x, audience });
}

/** The words a delivery says, and their sensitivity (ruling 9, 10 and 13). Pure. */
export function errandWords(e: Pick<Errand, "outcome" | "about" | "notice" | "lines">, verdicts: readonly LineVerdict[], audience: Au): { text: string; sens: Sens; said: LineVerdict[] } {
  // Review fix T8: code words an outcome with no line; mail from a stranger is said only in private.
  if (e.notice !== null && e.lines.length === 0) {
    if (e.notice === "unmailed" && audience !== "private") return { text: ERRAND_HELD_LINE, sens: "S0", said: [] };
    return { text: errandNoticeLine(e.notice, e.about), sens: errandNoticeSens(e.notice), said: [] };
  }
  if (e.outcome === "failed" || e.outcome === null) return { text: errandFailedLine(e.about), sens: "S0", said: [] };
  if (e.outcome === "nothing" || verdicts.length === 0) return { text: errandNothingLine(e.about), sens: "S0", said: [] };
  const said = verdicts.filter((v) => v.shown === "say" && v.line.sens !== "S2" && v.line.speak);
  // Review fix T9: "on your screen" only when the card shows that line to this audience; else the held line.
  const carded = verdicts.some((v) => v.shown === "card" && cardShows(v, audience));
  if (said.length === 0) return { text: carded ? ERRAND_ON_SCREEN_LINE : ERRAND_HELD_LINE, sens: "S0", said: [] };
  const lines = said.map((v) => (v.line.attribution === null ? v.line.text : `${v.line.attribution} ${v.line.text}`));
  const text = [ERRAND_FOUND_LEAD, ...lines, ...(carded ? [ERRAND_REST_ON_SCREEN_LINE] : [])].join(" ").slice(0, 1024);
  const sens: Sens = said.some((v) => v.line.sens === "S1") ? "S1" : "S0";
  return { text, sens, said };
}

const TRUST = ["U", "C", "O", "T", "M"] as const;

/** The noteId of an Errand's offer `attempt`: the receipt names it. */
export const errandOfferNoteId = (hasher: RouteContext["deps"]["hasher"], errandId: string, attempt: number): ID => hasher.id(["errandNote", errandId, String(attempt)]) as ID;

interface Claimed {
  proactive: Proactive;
  errand: Errand;
  audience: Au;
  modifiers: { rushed: boolean; crisis: boolean };
}

/**
 * The claim (ruling 9; review fixes V2 and V4): one transaction that rereads the Errand, the Session and the core and
 * gates there; null when an offer is out, the Errand moved, the Session or the Stamp moved, or the epoch did.
 */
async function claimDelivery(ctx: RouteContext, x: ErrandStateInput, errandId: ID, e: Errand, verdictsOf: (e: Errand, au: Au, mods: { rushed: boolean; crisis: boolean }) => LineVerdict[]): Promise<Claimed | null> {
  const { uid, deps } = ctx;
  try {
    return await deps.store.transaction(uid, async (tx) => {
      const [doc, sessionDoc, core] = await Promise.all([tx.get<Errand>(paths.errand(uid, errandId)), tx.get<Session>(paths.session(uid, x.sessionId)), readCoreDocs(tx, uid)]);
      const ops = deps.clock.read().opsClock.now;
      if (doc === null || !errandWaiting(doc.data.status) || doc.data.rev !== e.rev || doc.data.sessionId !== x.sessionId) return null;
      if (doc.data.offer !== null && msFromTs(doc.data.offer.expiresAt) > ops) return null;
      if (doc.data.readyAt === null || msFromTs(doc.data.readyAt) + ERRAND_RESULT_TTL_MS <= ops) return null;
      // Review fix V4: the Session still active on this generation, with a call, not narrowed here.
      const s = sessionDoc?.data ?? null;
      if (s === null || s.status !== "active" || s.generation !== x.session.generation || s.registeredCallIds.length === 0 || narrowedHere(s)) return null;
      const ep = core.epoch.data;
      if (ep.barrier !== null || ep.epoch !== doc.data.claimedEpoch || ep.epoch !== x.stamp.epoch) return null;
      const now = currentStamp(x.sessionId, s.generation, { epoch: ep, rules: core.rules.data, bundle: core.bundle.data });
      if (now.policyRev !== x.stamp.policyRev || now.bundleRev !== x.stamp.bundleRev || now.rulesRev !== x.stamp.rulesRev || now.generation !== x.stamp.generation) return null;
      const { audience, modifiers } = gateAudience(s, ops);
      if (modifiers.crisis) return null;
      const verdicts = verdictsOf(doc.data, audience, modifiers);
      const words = errandWords(doc.data, verdicts, audience);
      const attempt = (doc.data.offer?.attempt ?? 0) + 1;
      const turnId = deps.hasher.id(["errandTurn", x.sessionId, errandId, String(attempt)]) as ID;
      const stamp = { ...x.stamp, turnId };
      const expiresAt = tsFromMs(ops + ERRAND_OFFER_MS);
      const whisper: W = {
        noteId: errandOfferNoteId(deps.hasher, errandId, attempt),
        rev: 1,
        kind: "moment",
        text: words.text,
        rootKeys: [],
        dependsOn: [...new Set(words.said.flatMap((v) => v.line.refs.map((r) => doc.data.reads.find((x2) => x2.ref === r)).filter((r) => r !== undefined).map((r) => `e:${r!.evidenceId}`)))].slice(0, 256),
        sens: words.sens,
        expiresAt,
        unprompted: true,
        momentId: errandId,
        tokens: [],
      };
      const permit = await admitErrandLine(tx, { uid, decisionId: errandDeliveryId(deps.hasher, errandId, attempt), errandId, stamp, head: x.deck!.head, turns: x.deck!.turns, whisper, audience, opsNow: ops, core: { epoch: ep.epoch, policyRev: ep.policyRev } }, deps);
      if (permit === null) return null;
      const at = { uid, now: tsFromMs(ops), epoch: ep.epoch, policyRev: ep.policyRev };
      for (const v of verdicts) {
        if (v.shown === "say") continue;
        const refs = v.line.refs.map((r) => doc.data.reads.find((x2) => x2.ref === r)).filter((r) => r !== undefined).slice(0, 8).map((r) => ({ type: "evidence" as const, id: r!.evidenceId, rev: r!.rev }));
        await writeGateDecision(tx, deps.hasher, at, v.result, { candidateId: v.candidateId, refs, noteIds: [whisper.noteId], momentId: null, sessionId: x.sessionId, turnId, audience, permitKind: "proactive" });
      }
      // What the offered line was, for its transcript's Turn (review fix V11): the lowest trust said, else O.
      const cls = words.said.reduce<(typeof TRUST)[number]>((a, v) => (TRUST.indexOf(v.line.cls) > TRUST.indexOf(a) ? v.line.cls : a), "O");
      const written: Errand = { ...doc.data, offer: { attempt, noteId: whisper.noteId, turnId, expiresAt, cls, sens: words.sens, text: words.text }, updatedAt: tsFromMs(ops) };
      tx.update(doc.path, written);
      return { proactive: { turnId, permit: { ...permit, expiresAt }, whisper, cards: [], asks: false }, errand: written, audience, modifiers };
    });
  } catch (error) {
    if (isStoreError(error, "staleRevision")) return null;
    throw error;
  }
}

/** One status move, or a strip, in its own transaction; the Errand as written, or null when it does not apply. */
async function move(ctx: RouteContext, errandId: ID, event: "forget" | "expired" | "strip"): Promise<Errand | null> {
  const { uid, deps } = ctx;
  try {
    return await deps.store.transaction(uid, async (tx) => {
      const doc = await tx.get<Errand>(paths.errand(uid, errandId));
      if (doc === null) return null;
      const now = tsFromMs(deps.clock.read().opsClock.now);
      // Review fix R12: past its window a row keeps nothing it found; its status stays.
      if (event === "strip") {
        if (doc.data.status === "running") return null;
        const bare: Errand = { ...doc.data, ...BARE, updatedAt: now };
        tx.update(doc.path, bare);
        return bare;
      }
      const next = nextErrandStatus(doc.data.status, event);
      if (next === null) return null;
      // A drop erases what the Errand found (ruling 14: gone from the next thought, derived data included).
      const written: Errand = event === "forget" ? { ...doc.data, ...BARE, status: next, endedAt: doc.data.endedAt ?? now, updatedAt: now } : { ...doc.data, status: next, offer: null, endedAt: now, updatedAt: now };
      tx.update(doc.path, written);
      return written;
    });
  } catch (error) {
    if (isStoreError(error, "staleRevision")) return null;
    throw error;
  }
}

/** What a dropped or stripped Errand keeps of what it found: nothing (the forget drop and the tick strip use the same). */
export const BARE = { lines: [], reads: [], gate: null, offer: null, retainUntil: null } as const satisfies Partial<Errand>;

/** Ruling 4: a running Errand whose Job is due, or whose lease lapsed, gets a runner after the response. */
export async function pickUp(ctx: RouteContext, errandId: ID): Promise<void> {
  const { uid, deps } = ctx;
  const job = (await deps.store.get<Job>(uid, paths.job(uid, errandId)))?.data ?? null;
  if (job === null) return;
  const ops = deps.clock.read().opsClock.now;
  if (job.status === "leased" && job.leaseUntil !== null && msFromTs(job.leaseUntil) <= ops) {
    try {
      await deps.store.transaction(uid, async (tx) => {
        const doc = await tx.get<Job>(paths.job(uid, errandId));
        if (doc === null || doc.data.status !== "leased" || doc.data.leaseUntil === null || msFromTs(doc.data.leaseUntil) > ops) return;
        tx.update(doc.path, { ...doc.data, status: "retry", leaseToken: null, leaseUntil: null, nextAttemptAt: tsFromMs(ops), updatedAt: tsFromMs(ops) });
      });
    } catch (error) {
      if (!isStoreError(error, "staleRevision")) throw error;
      return;
    }
    ctx.schedule(() => runErrand(ctx, errandId));
    return;
  }
  if ((job.status === "queued" || job.status === "retry") && msFromTs(job.nextAttemptAt) <= ops) ctx.schedule(() => runErrand(ctx, errandId));
}
