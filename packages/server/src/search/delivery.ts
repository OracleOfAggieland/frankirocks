import {
  type Deck, type ID, type Infer, type Proactive, type ReceiptRequest, type SS, type Session, type Stamp, type W,
  ERRAND_OFFER_MS, ERRAND_RESULT_TTL_MS, ERRAND_SILENCE_MS, SPEAK_CAP_MS, msFromTs, tsFromMs,
} from "@franki/core";
import { admitErrandLine } from "../admission/seam";
import { readCoreDocs } from "../core-docs";
import { currentStamp, sameStamp } from "../deck";
import type { RouteContext } from "../routes/runtime";
import { withDeadline } from "../clock/timers";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { latestWebSearch, type WebSearchEntry } from "./tasks";

function spokenAnswer(p: WebSearchEntry["payload"]): string {
  if (p.status === "unavailable") return "I couldn't finish the web search.";
  if (p.status !== "found" || !p.findings.length) return "I couldn't verify an answer from the sources I found.";
  const rest = p.findings.length > 1 ? "The other results and sources are on your screen." : "The source is on your screen.";
  return `Here's what I found. ${p.findings[0]!.text} ${rest}`;
}

/** A tool read owns delivery while its answer plays. A cancelled read can be offered at a later pause. */
export async function reserveWebAnswer(tx: Tx, ctx: RouteContext, stamp: Stamp, taskId: ID, permitId: ID) {
  const path = paths.ledger(ctx.uid, taskId);
  const row = (await tx.get<WebSearchEntry>(path))?.data;
  if (row?.kind !== "webSearch" || row.epoch !== stamp.epoch || row.payload.sessionId !== stamp.sessionId ||
      row.payload.generation !== stamp.generation || row.payload.delivered || row.payload.status === "searching") return;
  const now = ctx.deps.clock.read().opsClock.now;
  const offer = { attempt: (row.payload.offer?.attempt ?? 0) + 1, turnId: stamp.turnId, noteId: permitId, expiresAt: tsFromMs(now + SPEAK_CAP_MS), state: "offered" as const };
  tx.update(path, { ...row, payload: { ...row.payload, offer } });
}

/** A quiet state poll may offer the requested answer once. A fresh transaction rechecks the audience and task. */
export async function offerWebAnswer(ctx: RouteContext, taskId: ID, stamp: SS, deck: Deck, budgetMs: number, speechAt: string | null): Promise<Proactive | null> {
  if (budgetMs <= 0) return null;
  const { uid, deps } = ctx;
  const deadline = deps.clock.read().opsClock.now + budgetMs;
  return withDeadline(deps.store.transaction(uid, async (tx) => {
    const [session, core] = await Promise.all([tx.get<Session>(paths.session(uid, stamp.sessionId)), readCoreDocs(tx, uid)]);
    const s = session?.data;
    if (!s || s.status !== "active" || !s.registeredCallIds.length || core.epoch.data.barrier !== null) return null;
    if (!sameStamp(stamp, currentStamp(stamp.sessionId, s.generation, { epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data }))) return null;
    const row = await latestWebSearch(tx, ctx, stamp.sessionId, s, stamp.epoch);
    if (!row || row.id !== taskId) return null;
    const now = deps.clock.read().opsClock.now;
    const p = row.data.payload;
    const lastSound = Math.max(msFromTs(s.lastTurnAt), s.lastSpeechStartedOpsAt ? msFromTs(s.lastSpeechStartedOpsAt) : 0, speechAt ? msFromTs(speechAt) : 0);
    if (now >= deadline || now - lastSound < ERRAND_SILENCE_MS || now - msFromTs(row.data.updatedAt) >= ERRAND_RESULT_TTL_MS ||
        p.status === "searching" || p.delivered || (p.offer && msFromTs(p.offer.expiresAt) > now)) return null;
    const attempt = (p.offer?.attempt ?? 0) + 1;
    const turnId = deps.hasher.id(["webSearchTurn", taskId, attempt]);
    const noteId = deps.hasher.id(["webSearchNote", taskId, attempt]);
    const expiresAt = tsFromMs(now + ERRAND_OFFER_MS);
    const whisper: W = { noteId, rev: 1, kind: "moment", text: spokenAnswer(p), sens: "S2", unprompted: true, momentId: taskId, expiresAt, rootKeys: [], dependsOn: [], tokens: [] };
    const permit = await admitErrandLine(tx, {
      uid, errandId: taskId, taskRefType: "ledger", decisionId: deps.hasher.id(["webSearchOffer", taskId, attempt]),
      stamp: { ...stamp, turnId }, head: deck.head, turns: deck.turns, whisper, audience: "private", opsNow: now, core: stamp,
    }, deps);
    if (!permit) return null;
    tx.update(row.path, { ...row.data, payload: { ...p, offer: { attempt, turnId, noteId, expiresAt, state: "offered" } } });
    return { source: "webSearch", turnId, permit: { ...permit, expiresAt }, whisper, asks: false, cards: [] } satisfies Proactive;
  }), budgetMs, deps.timers).catch(() => null);
}

/** Match the issuing turn and permit/offer. Only uninterrupted playback completion consumes the result. */
export async function webAnswerReceipt(tx: Tx, ctx: RouteContext, req: Infer<typeof ReceiptRequest>, now: number): Promise<boolean> {
  if (req.momentIds.length !== 1 || req.noteIds.length !== 1) return false;
  const row = await tx.get<WebSearchEntry>(paths.ledger(ctx.uid, req.momentIds[0]!));
  if (row?.data.kind !== "webSearch") return false;
  const p = row.data.payload;
  if (row.data.epoch !== req.stamp.epoch || p.sessionId !== req.stamp.sessionId || p.generation !== req.stamp.generation) return false;
  // A delayed receipt from an earlier offer carries private material too. Ignore it without attributing it to a new offer.
  if (!p.offer || p.offer.turnId !== req.stamp.turnId || p.offer.noteId !== req.noteIds[0] || p.delivered || p.offer.state === "cancelled") return true;
  if (req.kind === "playbackEnded") tx.update(row.path, { ...row.data, payload: { ...p, delivered: true } });
  if (req.kind === "playbackStarted" || req.kind === "cancelled") {
    const expiresAt = tsFromMs(now + (req.kind === "cancelled" ? 0 : SPEAK_CAP_MS));
    tx.update(row.path, { ...row.data, payload: { ...p, offer: { ...p.offer, expiresAt, state: req.kind === "cancelled" ? "cancelled" : "playing" } } });
  }
  return true;
}
