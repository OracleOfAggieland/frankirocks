/**
 * Delivery on the wire (brief 023 task 6; contracts `Proactive={turnId,permit,whisper,cards}`). The open and state
 * routes will call these (seams; `routes/open.ts` and `state.ts` are the writes lane's, so nothing calls them yet):
 *
 *   `chooseNow`    reads the opened (leased) moments, today's counts and the owner's world time, and runs the pure
 *                  `chooseDelivery`;
 *   `proactiveOf`  turns the chosen moment into a `Proactive` for a session stamp: a code-worded whisper and a
 *                  `proactive` Permit bound to the hash of the reply payload the browser will check (brief 045,
 *                  finding 3): the stamp, the Deck the same answer carries (its Head and safe turns), the whisper
 *                  as the one note, no audio and no tool output. S2 never goes on the wire (KC09 floor).
 */
import {
  type Card,
  type Deck,
  type DeliveryCandidate,
  type DeliveryChoice,
  type DeliveryMode,
  type GateResult,
  type ID,
  type Ledger,
  type Memory,
  type Moment,
  type Permit,
  type Proactive,
  type Sens,
  type SessionHolds,
  type Stamp,
  type W,
  PERMIT_TTL_MS,
  payloadHash,
  chooseDelivery,
  civilDateAt,
  idParts,
  isHeavy,
  gate,
  isMustSay,
  saidTokens,
  todayCounts,
  tsFromMs,
} from "@franki/core";

import { ownerClock, readCoreDocs } from "../core-docs";
import { storeReader } from "../head-build";
import { compareLoop, heroOffer } from "../routes/tool-food";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import { scanMoments } from "./tick";
import { getMoment, momentNoteId, momentVerdict } from "./verdict";
import { offerAnswer } from "./answered";
import { type GateSignals, candidateSensOf, gateCandidateOf, gateContextOf } from "./gate-candidate";
import { heldReminderText } from "./held-reminder";
import { isStoreError } from "../store/errors";

/**
 * The session's signals. Brief 036 finding 4: pass `transition` and `crisis` separately; the older
 * `transitionOrCrisis` still reads, and holds as both (fails closed).
 */
export type SessionSignals = SessionHolds & GateSignals & { turnsSinceCheckInAnswer: number | null };

/** Brief 042 item 4: a Gate verdict inside delivery that was not `say`, for the route to write as a row. */
export interface DeliveryVerdict {
  momentId: ID;
  /** The moment's revision when the Gate was asked. */
  rev: number;
  result: GateResult;
  /** The moment as read, and the owner's world time then (brief 042 item 3 reads a held reminder from them). */
  moment?: Moment;
  worldNow?: number;
}

/**
 * The delivery choice now, over the opened moments whose lease still holds and whose source rereads `ok`. Brief 042
 * item 4: `verdicts` holds each candidate the Gate did not let through (held, steered, declined or blocked).
 */
export async function chooseNow(ctx: RouteContext, mode: DeliveryMode, signals: SessionSignals): Promise<{ choice: DeliveryChoice; moments: Map<ID, Moment>; verdicts?: DeliveryVerdict[] }> {
  const { uid, deps } = ctx;
  const reader = storeReader(deps.store, uid);
  const core = await readCoreDocs(reader, uid);
  const pair = ownerClock(core.state.data, deps.clock);
  const all = (await scanMoments(reader, uid)) ?? [];
  const leased = all.filter((r) => r.data.status === "leased" && r.data.leaseUntil !== null && Date.parse(r.data.leaseUntil) > pair.opsClock.now);
  // Brief 036 finding 2: every candidate's source is reread with the tick's verdict; anything not `ok` is skipped.
  const hero = leased.some((r) => r.data.rollupId !== null) ? await heroOffer(ctx, 0).catch(() => null) : undefined;
  const rollupLive = hero === undefined ? null : hero !== null;
  const rows: typeof leased = [];
  for (const r of leased) if ((await momentVerdict(reader, uid, r.data, core, deps.clock, { rollupLive })) === "ok") rows.push(r);
  // Brief 042 item 2: an offer already answered, yes or no, is not offered again.
  const ledgerGet = (p: string) => reader.get<Ledger>(p);
  for (let i = rows.length - 1; i >= 0; i--) if ((await offerAnswer(ledgerGet, uid, rows[i]!.data, deps.hasher, hero?.pendingId ?? null)) !== null) rows.splice(i, 1);
  const today = todayCounts(core.counters.data, civilDateAt(pair.worldClock.now, pair.worldClock.zone));
  // Brief 036 finding 3: the Gate runs here, for every candidate, in the unprompted context of this session. Only a
  // `say` that needs no sender's attribution (a code-worded line carries none) is offered to delivery.
  const context = gateContextOf(core, pair, mode, signals, today);
  const said: typeof rows = [];
  const verdicts: DeliveryVerdict[] = [];
  for (const r of rows) {
    const candidate = await gateCandidateOf(reader, uid, r.id as ID, r.data, pair.worldClock.now);
    if (candidate === null) continue;
    const g = gate(candidate, context);
    if (g.verdict === "say" && g.render !== "attributed") said.push(r);
    else if (g.verdict !== "say") verdicts.push({ momentId: r.id as ID, rev: r.data.rev, result: g, moment: r.data, worldNow: pair.worldClock.now });
  }
  const moments = new Map(said.map((r) => [r.id as ID, r.data]));
  const candidates: DeliveryCandidate[] = [];
  for (const r of said) {
    const source = r.data.memoryId === null ? null : await reader.get<Memory>(paths.memory(uid, r.data.memoryId));
    const override = r.data.deliveryOverride;
    candidates.push({
      momentId: r.id,
      kind: r.data.kind,
      dueAt: Date.parse(r.data.dueAt),
      heavy: isHeavy(r.data.kind, source?.data.gravity ?? 0),
      mustSay: isMustSay(r.data.kind, Date.parse(r.data.dueAt), pair.worldClock.now),
      override: override === null ? null : { quietHours: override.quietHours, caps: override.caps },
    });
  }
  const choice = chooseDelivery({
    candidates,
    mode,
    ...signals,
    today,
    worldNow: pair.worldClock.now,
    zone: pair.worldClock.zone,
  });
  return { choice, moments, verdicts };
}

/**
 * Brief 045 finding 7: the moment kinds whose line asks for an answer (the hero offer, an offer, a question). A
 * typed screen neither shows nor admits them (a screen receipt admits none).
 */
export const ASKS_FOR_ANSWER: ReadonlySet<string> = new Set(["pattern", "offer", "ask"]);
export const asksForAnswer = (m: Pick<Moment, "payload">): boolean => ASKS_FOR_ANSWER.has(m.payload.kind);

/**
 * The line a moment speaks, worded by code; null when it can't be worded now. Its sensitivity is the Gate's. Brief
 * 045 finding 12: with the pending ID the line offers, if any, recorded with the render.
 */
async function lineOf(ctx: RouteContext, m: Moment): Promise<{ text: string; pendingId: string | null } | null> {
  let pendingId: string | null = m.payload.kind === "offer" || m.payload.kind === "ask" ? m.payload.pendingId : null;
  const text = await wordedLine(ctx, m, (id) => (pendingId = id));
  return text === null ? null : { text, pendingId };
}

async function wordedLine(ctx: RouteContext, m: Moment, offered: (pendingId: string) => void): Promise<string | null> {
  if (m.payload.kind === "cue") {
    // Brief 042 item 3: a reminder held under crisis past its due time is said late, by its own template.
    const late = await heldReminderText(ctx, m);
    if (late !== null) return late;
    return m.payload.template?.text ?? null;
  }
  if (m.payload.kind === "pattern") {
    const offer = await heroOffer(ctx, 0);
    if (offer !== null) offered(offer.pendingId);
    return offer?.line ?? null;
  }
  if (m.payload.kind === "celebrate") {
    const c = await compareLoop(ctx, m.payload.loopId, 0);
    return c?.lines == null ? null : c.lines.join(" ");
  }
  return null;
}

/**
 * The sensitivity a moment's line goes on the wire at: the Gate candidate's, read now (brief 045, finding 8). A
 * reminder is as sensitive as the rows it came from; it is never S0 because its cue points at no memory. Null (the
 * line is not put out) when the source can't be read.
 */
async function sensOf(ctx: RouteContext, m: Moment): Promise<Sens | null> {
  return candidateSensOf(storeReader(ctx.deps.store, ctx.uid), ctx.uid, m);
}

/**
 * Records the line a moment goes on the wire as (brief 036 finding 6), in a transaction that rereads the moment
 * (still leased under the same lease and generation) and its source. Returns false, writing nothing, otherwise.
 */
async function render(ctx: RouteContext, momentId: ID, m: Moment, noteId: string, text: string, sent: { sessionId: ID; pendingId: ID | null }): Promise<boolean> {
  const { uid, deps } = ctx;
  try {
    return await deps.store.transaction(uid, async (tx) => {
      const doc = await getMoment(tx, paths.moment(uid, momentId));
      if (doc === null || doc.data.status !== "leased" || doc.data.leaseToken !== m.leaseToken || doc.data.generation !== m.generation) return false;
      const core = await readCoreDocs(tx, uid);
      if (core.epoch.data.barrier !== null) return false;
      const ops = ownerClock(core.state.data, deps.clock).opsClock.now;
      if (doc.data.leaseUntil === null || Date.parse(doc.data.leaseUntil) <= ops) return false;
      // The line was just worded from the rollup's detector, so it passes now.
      if ((await momentVerdict(tx, uid, doc.data, core, deps.clock, { rollupLive: true })) !== "ok") return false;
      tx.update(doc.path, { ...doc.data, rendered: { noteId, text, tokens: saidTokens(text), at: tsFromMs(ops), sessionId: sent.sessionId, pendingId: sent.pendingId }, updatedAt: tsFromMs(ops) });
      return true;
    });
  } catch (error) {
    if (isStoreError(error, "staleRevision")) return false;
    throw error;
  }
}

/** The Deck a `Proactive` goes out with: the browser hashes its Head and safe turns into the reply payload. */
export type ProactiveDeck = Pick<Deck, "head" | "turns">;

/**
 * The chosen moment as a `Proactive` for this session's stamp, or null (no words, S2, or no longer leased). The
 * Permit is bound to the payload the browser checks with `deck`, the Deck in the same answer. With no Deck the Permit
 * is bound to a null Head, which no browser holds, so the line never plays (fails closed).
 */
export async function proactiveOf(ctx: RouteContext, momentId: ID, m: Moment, stamp: Stamp, deck: ProactiveDeck | null = null): Promise<Proactive | null> {
  const { deps } = ctx;
  const worded = await lineOf(ctx, m);
  const line = worded?.text ?? null;
  const sens = line === null ? null : await sensOf(ctx, m);
  if (line === null || sens === null || sens === "S2") return null;
  const noteId = momentNoteId(deps.hasher, momentId, m) as ID;
  const text = line.slice(0, 1024);
  if (!(await render(ctx, momentId, m, noteId, text, { sessionId: stamp.sessionId as ID, pendingId: (worded?.pendingId ?? null) as ID | null }))) return null;
  const ops = deps.clock.read().opsClock.now;
  const expiresAt = tsFromMs(ops + PERMIT_TTL_MS);
  const whisper: W = {
    noteId,
    rev: 1,
    kind: "moment",
    text,
    rootKeys: m.rootKeys.slice(0, 128),
    dependsOn: m.dependsOn.slice(0, 256),
    sens,
    expiresAt,
    unprompted: true,
    momentId,
    tokens: [],
  };
  const approvedPayloadHash = payloadHash({ stamp, head: deck?.head ?? null, notes: [whisper], turns: deck?.turns ?? [], audioIds: [], toolOutput: null }, deps.hasher);
  const permit: Permit = {
    permitId: deps.hasher.id(idParts.permit(stamp, "proactive", approvedPayloadHash)) as ID,
    stamp,
    kind: "proactive",
    scope: "reply",
    approvedPayloadHash,
    noteIds: [whisper.noteId],
    momentIds: [momentId],
    expiresAt,
  };
  const cards: Card[] = [];
  return { turnId: deps.hasher.id(["proactiveTurn", stamp.sessionId, momentId, m.generation]) as ID, permit, whisper, cards, asks: asksForAnswer(m) };
}
