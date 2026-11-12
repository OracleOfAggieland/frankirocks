/**
 * Delivery on the wire (brief 023 task 6; contracts `Proactive={turnId,permit,whisper,cards}`). The open and state
 * routes will call these (seams; `routes/open.ts` and `state.ts` are the writes lane's, so nothing calls them yet):
 *
 *   `chooseNow`    reads the opened (leased) moments, today's counts and the owner's world time, and runs the pure
 *                  `chooseDelivery`;
 *   `proactiveOf`  turns the chosen moment into a `Proactive` for a session stamp: a code-worded whisper and a
 *                  `proactive` Permit bound to its hash. S2 never goes on the wire (KC09 floor).
 */
import {
  type Card,
  type DeliveryCandidate,
  type DeliveryChoice,
  type DeliveryMode,
  type ID,
  type Memory,
  type Moment,
  type Permit,
  type Proactive,
  type Sens,
  type Stamp,
  type W,
  PERMIT_TTL_MS,
  canonicalJSON,
  chooseDelivery,
  civilDateAt,
  idParts,
  isHeavy,
  isMustSay,
  todayCounts,
  tsFromMs,
} from "@franki/core";

import { ownerClock, readCoreDocs } from "../core-docs";
import { storeReader } from "../head-build";
import { compareLoop, heroOffer } from "../routes/tool-food";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import { scanMoments } from "./tick";
import { momentNoteId } from "./verdict";

export interface SessionSignals {
  transitionOrCrisis: boolean;
  turnsSinceCheckInAnswer: number | null;
}

/** The delivery choice now, over the opened moments whose lease still holds. */
export async function chooseNow(ctx: RouteContext, mode: DeliveryMode, signals: SessionSignals): Promise<{ choice: DeliveryChoice; moments: Map<ID, Moment> }> {
  const { uid, deps } = ctx;
  const reader = storeReader(deps.store, uid);
  const core = await readCoreDocs(reader, uid);
  const pair = ownerClock(core.state.data, deps.clock);
  const all = (await scanMoments(reader, uid)) ?? [];
  const rows = all.filter((r) => r.data.status === "leased" && r.data.leaseUntil !== null && Date.parse(r.data.leaseUntil) > pair.opsClock.now);
  const moments = new Map(rows.map((r) => [r.id as ID, r.data]));
  const candidates: DeliveryCandidate[] = [];
  for (const r of rows) {
    const source = r.data.memoryId === null ? null : await reader.get<Memory>(paths.memory(uid, r.data.memoryId));
    const override = r.data.deliveryOverride;
    candidates.push({
      momentId: r.id,
      kind: r.data.kind,
      dueAt: Date.parse(r.data.dueAt),
      heavy: isHeavy(r.data.kind, source?.data.gravity ?? 0),
      mustSay: isMustSay(r.data.kind),
      override: override === null ? null : { quietHours: override.quietHours, caps: override.caps },
    });
  }
  const choice = chooseDelivery({
    candidates,
    mode,
    ...signals,
    today: todayCounts(core.counters.data, civilDateAt(pair.worldClock.now, pair.worldClock.zone)),
    worldNow: pair.worldClock.now,
    zone: pair.worldClock.zone,
  });
  return { choice, moments };
}

/** The line a moment speaks, worded by code, and its sensitivity; null when it can't be worded now. */
async function lineOf(ctx: RouteContext, m: Moment): Promise<{ text: string; sens: Sens } | null> {
  const { uid, deps } = ctx;
  if (m.payload.kind === "cue") {
    const text = m.payload.template?.text ?? null;
    if (text === null) return null;
    const ref = m.payload.noteRef;
    const source = ref.type === "memory" ? await deps.store.get<Memory>(uid, paths.memory(uid, ref.id)) : null;
    return { text, sens: source?.data.sens ?? "S0" };
  }
  if (m.payload.kind === "pattern") {
    const offer = await heroOffer(ctx, 0);
    return offer === null ? null : { text: offer.line, sens: "S1" };
  }
  if (m.payload.kind === "celebrate") {
    const c = await compareLoop(ctx, m.payload.loopId, 0);
    return c?.lines == null ? null : { text: c.lines.join(" "), sens: "S1" };
  }
  return null;
}

/** The chosen moment as a `Proactive` for this session's stamp, or null (no words, or S2). */
export async function proactiveOf(ctx: RouteContext, momentId: ID, m: Moment, stamp: Stamp): Promise<Proactive | null> {
  const { deps } = ctx;
  const line = await lineOf(ctx, m);
  if (line === null || line.sens === "S2") return null;
  const ops = deps.clock.read().opsClock.now;
  const expiresAt = tsFromMs(ops + PERMIT_TTL_MS);
  const whisper: W = {
    noteId: momentNoteId(deps.hasher, momentId, m) as ID,
    rev: 1,
    kind: "moment",
    text: line.text.slice(0, 1024),
    rootKeys: m.rootKeys.slice(0, 128),
    dependsOn: m.dependsOn.slice(0, 256),
    sens: line.sens,
    expiresAt,
    unprompted: true,
    momentId,
    tokens: [],
  };
  const approvedPayloadHash = deps.hasher.sha256(new TextEncoder().encode(canonicalJSON({ whisper, momentId })));
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
  return { turnId: deps.hasher.id(["proactiveTurn", stamp.sessionId, momentId, m.generation]) as ID, permit, whisper, cards };
}
