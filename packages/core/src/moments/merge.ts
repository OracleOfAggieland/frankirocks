/**
 * Plans to rows (brief 023; design note 023 §1). `momentRow` builds a new pending row; `mergeMoment` decides whether
 * a stored row changes. Only a `pending` row is ever rewritten: once a moment has opened, been admitted, said,
 * skipped, expired or cancelled, derive leaves it alone, so a moved occasion keeps its `said`.
 */
import type { Hasher } from "../ids";
import { canonicalJSON } from "../ids";
import { tsFromMs } from "../schema/primitives";
import type { Moment } from "../schema/records";
import type { MomentPlan } from "./types";

export interface RowContext {
  uid: string;
  opsNow: number;
  epoch: number;
  policyRev: number;
  clockMode: "live" | "fixture";
  /**
   * The owner's world time, when the caller knows it. Brief 036 finding 12: only with it may a wish skipped because
   * its start passed be revived by a move that puts the start ahead again. Without it nothing is revived.
   */
  worldNow?: number;
}

/** contracts `deliveryKey = H(moment, occurrence, channel)`; the floor keys one delivery per occurrence. */
export const deliveryKeyOf = (hasher: Hasher, momentId: string, occurrenceKey: string): string => hasher.id(["delivery", momentId, occurrenceKey]);

export function momentRow(p: MomentPlan, c: RowContext, hasher: Hasher): Moment {
  const now = tsFromMs(c.opsNow);
  return {
    v: 1,
    uid: c.uid,
    rev: 1,
    createdAt: now,
    updatedAt: now,
    epoch: c.epoch,
    policyRev: c.policyRev,
    rootKeys: p.lineage.rootKeys,
    rootSlices: p.lineage.rootSlices,
    contextIds: [],
    packetEids: [],
    dependsOn: p.lineage.dependsOn,
    dirty: false,
    dependenciesComplete: true,
    memoryId: p.source.kind === "memory" ? p.source.id : null,
    rollupId: p.source.kind === "rollup" ? p.source.id : null,
    actionId: p.source.kind === "action" ? p.source.id : null,
    kind: p.kind,
    occurrenceKey: p.occurrenceKey,
    scheduleRev: p.scheduleRev,
    domain: p.domain,
    clockMode: c.clockMode,
    backoffDays: 0,
    uptakeEid: null,
    cueTiming: null,
    cueTokens: [],
    status: "pending",
    dueAt: tsFromMs(p.dueAt),
    closeAt: tsFromMs(p.closeAt),
    nextReviewAt: tsFromMs(p.closeAt),
    anchorId: null,
    subjectIds: p.subjectIds.slice(0, 16),
    topicIds: [],
    authorized: null,
    deliveryOverride: null,
    payload: p.payload,
    leaseToken: null,
    leaseUntil: null,
    generation: 0,
    attempts: 0,
    admittedAt: null,
    saidAt: null,
    playbackAt: null,
    responseId: null,
    deliveryKey: deliveryKeyOf(hasher, p.momentId, p.occurrenceKey),
    saidMatch: "none",
    cancelReason: null,
    rendered: null,
  };
}

/** The fields derive owns on a pending row. */
const planned = (m: Moment) =>
  canonicalJSON([m.scheduleRev, m.dueAt, m.closeAt, m.nextReviewAt, m.payload, m.subjectIds, m.domain, m.rootKeys, m.rootSlices, m.dependsOn]);

/**
 * A wish skipped because its start passed (by a move, or by time), never admitted or said, whose new plan puts the
 * start ahead of the world time again (brief 036 finding 12). Each occurrence is still admitted at most once.
 */
function revivable(existing: Moment, p: MomentPlan, c: RowContext): boolean {
  return (
    existing.status === "skipped" &&
    existing.kind === "wish" &&
    p.kind === "wish" &&
    existing.admittedAt === null &&
    existing.saidAt === null &&
    c.worldNow !== undefined &&
    Number.isFinite(c.worldNow) &&
    p.closeAt > c.worldNow
  );
}

/** The row to write for a plan, or null when nothing changes. */
export function mergeMoment(existing: Moment | null, p: MomentPlan, c: RowContext, hasher: Hasher): Moment | null {
  const fresh = momentRow(p, c, hasher);
  if (existing === null) return fresh;
  if (existing.status !== "pending" && existing.status !== "leased" && !revivable(existing, p, c)) return null;
  if (planned(existing) === planned(fresh)) return null;
  return {
    ...existing,
    status: "pending",
    leaseToken: null,
    leaseUntil: null,
    rendered: null,
    scheduleRev: fresh.scheduleRev,
    dueAt: fresh.dueAt,
    closeAt: fresh.closeAt,
    nextReviewAt: fresh.nextReviewAt,
    payload: fresh.payload,
    subjectIds: fresh.subjectIds,
    domain: fresh.domain,
    rootKeys: fresh.rootKeys,
    rootSlices: fresh.rootSlices,
    dependsOn: fresh.dependsOn,
    updatedAt: tsFromMs(c.opsNow),
  };
}

/**
 * A retired moment (a wish moved to at or after its start): a pending or leased row is skipped, and a lease is
 * dropped (brief 036 finding 1); anything else stays.
 */
export function retireMoment(existing: Moment | null, c: RowContext): Moment | null {
  if (existing === null || (existing.status !== "pending" && existing.status !== "leased")) return null;
  return { ...existing, status: "skipped", leaseToken: null, leaseUntil: null, updatedAt: tsFromMs(c.opsNow) };
}
