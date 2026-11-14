/**
 * Brief 049 part A, rulings 4, 7, 9, 10, 11, 12 and 14: what the state poll does with the owner's Errands. One call
 * from `routes/state.ts`, after its own transaction has committed, never inside it.
 *
 *   1. One query: the owner's most recent Errands (`recentErrands`). With none, nothing more is read.
 *   2. Upkeep, each in its own small transaction: an Errand claimed before the current epoch is `dropped` (a forget
 *      moved the epoch; its lines and reads are erased); a waiting result whose Session is not this one, or that
 *      nobody heard within `ERRAND_RESULT_TTL_MS`, goes `cardOnly`; a running Errand whose Job's lease lapsed, or
 *      that never started, gets a runner scheduled (`ctx.schedule`), so a run whose instance died is picked up.
 *   3. The view (rulings 11, 12): what this Session's running Errands look through, and the cards of delivered or
 *      card-only results of this epoch from the last `ERRAND_CARD_KEEP_MS`, each line gated for the audience now.
 *   4. Delivery (ruling 9): only in a call, only when the route's own checks passed (`mayOffer`: a StateAck and a
 *      Deck), only after `ERRAND_SILENCE_MS` of quiet, for the oldest waiting result of this Session and epoch. The
 *      words are code's (`errandWords`), gated (`gateErrandLines`); the claim is one transaction that rereads the
 *      Errand and the epoch, writes the Gate rows of every line not said, moves the Errand to `delivered` and has the
 *      Admission_Seam write the decision row (`admitErrandLine`). Whoever writes that row first says the line; nobody
 *      else does.
 *
 * Fails closed: any failure here says nothing and shows nothing, and never fails the poll.
 */
import {
  type Au,
  ERRAND_CARD_KEEP_MS,
  ERRAND_FOUND_LEAD,
  ERRAND_HELD_LINE,
  ERRAND_ON_SCREEN_LINE,
  ERRAND_REST_ON_SCREEN_LINE,
  ERRAND_RESULT_TTL_MS,
  ERRAND_SILENCE_MS,
  type Card,
  type CoreEpoch,
  type Errand,
  type ErrandAbout,
  type ErrandsView,
  type ID,
  type Job,
  type Proactive,
  type SS,
  type Sens,
  type Session,
  type Turn,
  type W,
  errandFailedLine,
  errandNothingLine,
  errandWaiting,
  msFromTs,
  nextErrandStatus,
  tsFromMs,
} from "@franki/core";
import { admitErrandLine } from "../admission/seam";
import { gateAudience } from "../audience";
import { ownerClock } from "../core-docs";
import { outsideTx } from "../forget/ack";
import { writeGateDecision } from "../ledger/said";
import type { RouteContext } from "../routes/runtime";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import type { StoredDoc } from "../store/port";
import type { ProactiveDeck } from "../time/proactive";
import { assignmentWords } from "./assignment";
import { errandCard } from "./card";
import { type LineVerdict, gateErrandLines } from "./gate";
import { errandDeliveryId, recentErrands } from "./records";
import { runErrand } from "./run";

export const NO_ERRANDS: ErrandsView = { running: [], cards: [] };
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
}

/** The view and, at most, one line to say. Never throws. */
export async function errandsOnState(ctx: RouteContext, x: ErrandStateInput): Promise<{ view: ErrandsView; proactive: Proactive | null }> {
  try {
    return await errandsOnce(ctx, x);
  } catch (e) {
    ctx.deps.log("errand.state", { error: e instanceof Error ? e.name : "unknown" });
    return { view: NO_ERRANDS, proactive: null };
  }
}

async function errandsOnce(ctx: RouteContext, x: ErrandStateInput): Promise<{ view: ErrandsView; proactive: Proactive | null }> {
  const { uid, deps } = ctx;
  const rows = await recentErrands(outsideTx(deps.store, uid), uid);
  if (rows.length === 0) return { view: NO_ERRANDS, proactive: null };
  const ops = deps.clock.read().opsClock.now;
  const epoch = x.stamp.epoch;
  const live: StoredDoc<Errand>[] = [];
  for (const r of rows) {
    const e = r.data;
    if (e.status === "dropped") continue;
    if (e.claimedEpoch !== epoch) {
      await move(ctx, r.id as ID, "forget");
      continue;
    }
    if (errandWaiting(e.status) && (e.sessionId !== x.sessionId || (e.readyAt !== null && msFromTs(e.readyAt) + ERRAND_RESULT_TTL_MS <= ops))) {
      const moved = await move(ctx, r.id as ID, "expired");
      if (moved !== null) live.push({ ...r, data: moved });
      continue;
    }
    if (e.status === "running") await pickUp(ctx, r.id as ID);
    live.push(r);
  }

  const zone = (await readZone(ctx)) ?? "UTC";
  const { audience, modifiers } = gateAudience(x.session, ops);
  const worldNow = ownerClock((await deps.store.get(uid, paths.core(uid, "state")))!.data as never, deps.clock).worldClock.now;
  const verdictsOf = async (e: Errand, id: ID): Promise<LineVerdict[]> => {
    const words = await assignmentWords(deps.store, uid, e.sessionId, e.assignmentTurnIds);
    const certain = await certainSpeaker(ctx, e);
    return gateErrandLines({ errand: e, ownerWords: words, certain, audience, modifiers, worldNow, zone, candidateId: (i) => deps.hasher.id(["errandLine", id, i]) as ID });
  };

  const running = new Set<ErrandAbout>();
  for (const r of live) if (r.data.status === "running" && r.data.sessionId === x.sessionId) for (const a of r.data.about) running.add(a);
  const cards: Card[] = [];
  for (const r of live) {
    const e = r.data;
    if (cards.length >= ERRAND_CARDS_MAX) break;
    if ((e.status !== "delivered" && e.status !== "cardOnly") || e.readyAt === null || msFromTs(e.readyAt) + ERRAND_CARD_KEEP_MS <= ops || e.lines.length === 0) continue;
    const card = errandCard(e, await verdictsOf(e, r.id as ID), { id: deps.hasher.id(["errandCard", r.id]) as ID, zone });
    if (card !== null) cards.push(card);
  }
  const view: ErrandsView = { running: [...running], cards };

  if (!x.mayOffer || x.deck === null || x.session.registeredCallIds.length === 0) return { view, proactive: null };
  const lastSound = Math.max(msFromTs(x.session.lastTurnAt), x.session.lastSpeechStartedOpsAt === null ? 0 : msFromTs(x.session.lastSpeechStartedOpsAt));
  if (!(ops - lastSound >= ERRAND_SILENCE_MS)) return { view, proactive: null };
  const due = live
    .filter((r) => errandWaiting(r.data.status) && r.data.sessionId === x.sessionId && r.data.readyAt !== null)
    .sort((a, b) => msFromTs(a.data.readyAt!) - msFromTs(b.data.readyAt!))[0];
  if (due === undefined) return { view, proactive: null };
  const id = due.id as ID;
  const verdicts = await verdictsOf(due.data, id);
  const proactive = await claimDelivery(ctx, x, id, due.data, verdicts, audience);
  // The card of a result just said goes out with it, not a poll later (ruling 11).
  const card = proactive === null || cards.length >= ERRAND_CARDS_MAX ? null : errandCard(due.data, verdicts, { id: deps.hasher.id(["errandCard", id]) as ID, zone });
  return { view: card === null ? view : { ...view, cards: [card, ...cards] }, proactive };
}

/** The words a delivery says, and their sensitivity (ruling 9, 10 and 13). Pure. */
export function errandWords(e: Pick<Errand, "outcome" | "about">, verdicts: readonly LineVerdict[]): { text: string; sens: Sens; said: LineVerdict[] } {
  if (e.outcome === "failed" || e.outcome === null) return { text: errandFailedLine(e.about), sens: "S0", said: [] };
  if (e.outcome === "nothing" || verdicts.length === 0) return { text: errandNothingLine(e.about), sens: "S0", said: [] };
  const said = verdicts.filter((v) => v.shown === "say" && v.line.sens !== "S2");
  const carded = verdicts.some((v) => v.shown === "card");
  if (said.length === 0) return { text: carded ? ERRAND_ON_SCREEN_LINE : ERRAND_HELD_LINE, sens: "S0", said: [] };
  const lines = said.map((v) => (v.line.attribution === null ? v.line.text : `${v.line.attribution} ${v.line.text}`));
  const text = [ERRAND_FOUND_LEAD, ...lines, ...(carded ? [ERRAND_REST_ON_SCREEN_LINE] : [])].join(" ").slice(0, 1024);
  const sens: Sens = said.some((v) => v.line.sens === "S1") ? "S1" : "S0";
  return { text, sens, said };
}

/** The claim (ruling 9): one transaction; null when another claim won, the Errand moved, or the epoch did. */
async function claimDelivery(ctx: RouteContext, x: ErrandStateInput, errandId: ID, e: Errand, verdicts: readonly LineVerdict[], audience: Au): Promise<Proactive | null> {
  const { uid, deps } = ctx;
  const words = errandWords(e, verdicts);
  const turnId = deps.hasher.id(["errandTurn", x.sessionId, errandId]) as ID;
  const stamp = { ...x.stamp, turnId };
  try {
    return await deps.store.transaction(uid, async (tx) => {
      const [doc, epochDoc] = await Promise.all([tx.get<Errand>(paths.errand(uid, errandId)), tx.get<CoreEpoch>(paths.core(uid, "epoch"))]);
      if (doc === null || !errandWaiting(doc.data.status) || doc.data.rev !== e.rev) return null;
      if (epochDoc === null || epochDoc.data.barrier !== null || epochDoc.data.epoch !== doc.data.claimedEpoch || epochDoc.data.epoch !== x.stamp.epoch) return null;
      const ops = deps.clock.read().opsClock.now;
      const whisper: W = {
        noteId: deps.hasher.id(["errandNote", errandId]) as ID,
        rev: 1,
        kind: "moment",
        text: words.text,
        rootKeys: [],
        dependsOn: [...new Set(words.said.flatMap((v) => v.line.refs.map((r) => doc.data.reads.find((x2) => x2.ref === r)).filter((r) => r !== undefined).map((r) => `e:${r!.evidenceId}`)))].slice(0, 256),
        sens: words.sens,
        expiresAt: tsFromMs(ops + 10_000),
        unprompted: true,
        momentId: errandId,
        tokens: [],
      };
      const permit = await admitErrandLine(tx, { uid, decisionId: errandDeliveryId(deps.hasher, errandId), errandId, stamp, head: x.deck!.head, turns: x.deck!.turns, whisper, audience, opsNow: ops, core: { epoch: epochDoc.data.epoch, policyRev: epochDoc.data.policyRev } }, deps);
      if (permit === null) return null;
      const next = nextErrandStatus(doc.data.status, "delivered");
      if (next === null) return null;
      const at = { uid, now: tsFromMs(ops), epoch: epochDoc.data.epoch, policyRev: epochDoc.data.policyRev };
      for (const v of verdicts) {
        if (v.shown === "say") continue;
        const refs = v.line.refs.map((r) => doc.data.reads.find((x2) => x2.ref === r)).filter((r) => r !== undefined).slice(0, 8).map((r) => ({ type: "evidence" as const, id: r!.evidenceId, rev: r!.rev }));
        await writeGateDecision(tx, deps.hasher, at, v.result, { candidateId: v.candidateId, refs, noteIds: [whisper.noteId], momentId: null, sessionId: x.sessionId, turnId, audience, permitKind: "proactive" });
      }
      tx.update(doc.path, { ...doc.data, status: next, endedAt: tsFromMs(ops), updatedAt: tsFromMs(ops) } satisfies Errand);
      return { turnId, permit: { ...permit, expiresAt: whisper.expiresAt }, whisper, cards: [], asks: false } satisfies Proactive;
    });
  } catch (error) {
    if (isStoreError(error, "staleRevision")) return null;
    throw error;
  }
}

/** One status move in its own transaction; the Errand as written, or null when the move does not apply. */
async function move(ctx: RouteContext, errandId: ID, event: "forget" | "expired"): Promise<Errand | null> {
  const { uid, deps } = ctx;
  try {
    return await deps.store.transaction(uid, async (tx) => {
      const doc = await tx.get<Errand>(paths.errand(uid, errandId));
      if (doc === null) return null;
      const next = nextErrandStatus(doc.data.status, event);
      if (next === null) return null;
      const now = tsFromMs(deps.clock.read().opsClock.now);
      // A drop erases what the Errand found (ruling 14: gone from the next thought, derived data included).
      const written: Errand = event === "forget" ? { ...doc.data, status: next, lines: [], reads: [], endedAt: doc.data.endedAt ?? now, updatedAt: now } : { ...doc.data, status: next, endedAt: now, updatedAt: now };
      tx.update(doc.path, written);
      return written;
    });
  } catch (error) {
    if (isStoreError(error, "staleRevision")) return null;
    throw error;
  }
}

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

async function readZone(ctx: RouteContext): Promise<string | null> {
  const doc = await ctx.deps.store.get(ctx.uid, paths.core(ctx.uid, "state"));
  if (doc === null) return null;
  return ownerClock(doc.data as never, ctx.deps.clock).worldClock.zone;
}

/** The speaker of the Errand's own Turn is certain: a typed Turn, or a spoken one the judge marked `O`. */
async function certainSpeaker(ctx: RouteContext, e: Errand): Promise<boolean> {
  const t = (await ctx.deps.store.get<Turn>(ctx.uid, paths.turn(ctx.uid, e.sessionId, e.turnId)))?.data ?? null;
  if (t === null || t.sourceClass !== "U") return false;
  return t.itemIds.length === 0 || t.judge === "O";
}
