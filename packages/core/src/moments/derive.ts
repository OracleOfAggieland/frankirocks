/**
 * `derive` for the floor (brief 023 task 2; spec §5 Floor rows; contracts "derive by kind"; design note 023 §1). Pure.
 *
 * A moment's ID is `H("moment", sourceId, kind, occurrenceKey)`. For an occasion the source is the root of its
 * `replacesIds` chain and the key its original civil start, so a moved occasion keeps every moment ID. No moment is
 * planned until its time resolves: `time: null`, or a `month` or `range` precision, plans nothing (KS03).
 */
import { addCivilDays, civilDateAt, localMinuteAt } from "../dates";
import type { Hasher } from "../ids";
import type { PatternResult } from "../patterns/types";
import { heroOfferLine } from "../patterns/words";
import { msFromTs, type Ref, type Time } from "../schema/primitives";
import type { Ledger, Memory, MomentKind } from "../schema/records";
import {
  CELEBRATE_CLOSE_DAYS,
  CHECKIN_AFTER_END_MS,
  CHECKIN_DAY_MINUTE,
  DAY_MS,
  INSIGHT_COOLDOWN_DAYS,
  OCCASION_DEFAULT_MINUTES,
  OTHER_CLOSE_DAYS,
  OUTCOME_CLOSE_DAYS,
  REMINDER_DAY_MINUTE,
  WISH_EARLIEST_MINUTE,
  WISH_LATEST_MINUTE,
  WISH_LEAD_MS,
} from "./constants";
import { type DeriveResult, type MomentPlan, NO_MOMENTS } from "./types";
import { checkInLine, expiryAskLine, reminderLine, wishLine } from "./words";

export const momentIdOf = (hasher: Hasher, sourceId: string, kind: MomentKind, occurrenceKey: string): string =>
  hasher.id(["moment", sourceId, kind, occurrenceKey]);

/** The insight rollup of the hero detector (design note 023 gap 10). */
export const heroRollupId = (hasher: Hasher): string => hasher.id(["rollup", "takeout_late_meeting_v1"]);

/** The floor's derive table as data (design note 023 §1). */
export const DERIVE_FLOOR = [
  { source: "occasion", kind: "wish", due: "max(08:00, min(08:30, start-3h)), local", close: "start", skip: "due >= start" },
  { source: "occasion", kind: "checkIn", due: "end+3h, or 18:00 local for a day-only date", close: "end+3d", skip: null },
  { source: "pattern", kind: "insight", due: "local midnight after the window", close: "due+30d", skip: "cooldown 30d" },
  { source: "loop", kind: "celebrate", due: "checkAt", close: "checkAt+7d", skip: "predicate fails at open" },
  { source: "boundedFact", kind: "expiryAsk", due: "validTo", close: "due+30d", skip: "rule or allergy" },
  { source: "reminder", kind: "commitmentDue", due: "the action's time, 09:00 local for a day", close: "due+30d", skip: null },
] as const;

const LIVE_SOURCE: readonly Memory["status"][] = ["active", "scheduled"];
const CHAIN_MAX = 16;

/** True when a time row has resolved far enough for a moment: an instant, or one civil day (or a run of days). */
export const isResolved = (t: Time | null): t is Time => t !== null && (t.precision === "instant" || t.precision === "day");

const memoryRef = (m: Memory): Ref => ({ type: "memory", id: m.logicalId, rev: m.rev });
const lineageOf = (m: Memory) => ({ rootKeys: m.rootKeys.slice(0, 128), rootSlices: m.rootSlices.slice(0, 128), dependsOn: [`m:${m.logicalId}@${m.rev}`] });

/**
 * The event Memory at the root of `m`'s `replacesIds` chain among `rows`, how many moves away it is, and the
 * occurrence key: the oldest resolved row's `originalCivilStart`, else its `civilStart`.
 */
export function occasionRoot(m: Memory, rows: ReadonlyMap<string, Memory>): { root: Memory; depth: number; occurrenceKey: string | null } {
  const path: Memory[] = [m];
  const seen = new Set([m.logicalId]);
  let at = m;
  while (path.length < CHAIN_MAX) {
    const prev = [...at.replacesIds]
      .sort()
      .map((id) => rows.get(id))
      .find((r): r is Memory => r !== undefined && r.predicate === "event" && !seen.has(r.logicalId));
    if (prev === undefined) break;
    seen.add(prev.logicalId);
    path.push(prev);
    at = prev;
  }
  const oldestResolved = [...path].reverse().find((r) => isResolved(r.time));
  const key = oldestResolved === undefined ? null : (oldestResolved.time!.originalCivilStart ?? oldestResolved.time!.civilStart);
  return { root: at, depth: path.length - 1, occurrenceKey: key };
}

function plan(m: Memory, sourceId: string, kind: MomentKind, key: string, depth: number, dueAt: number, closeAt: number, text: string, hasher: Hasher): MomentPlan {
  return {
    momentId: momentIdOf(hasher, sourceId, kind, key),
    source: { kind: "memory", id: sourceId },
    kind,
    occurrenceKey: key,
    scheduleRev: m.scheduleRev + depth,
    dueAt,
    closeAt: Math.max(closeAt, dueAt),
    domain: null,
    subjectIds: [m.subjectId],
    payload: { kind: "cue", noteRef: memoryRef(m), template: { text: text.slice(0, 512), entityRefs: m.entityIds.slice(0, 8), timeFields: [] } },
    noteRef: memoryRef(m),
    lineage: lineageOf(m),
  };
}

/** An occasion's wish and check-in (spec §5 Occasion, floor: no `prepare`, no `ask`). */
export function deriveOccasion(m: Memory, rows: ReadonlyMap<string, Memory>, hasher: Hasher): DeriveResult {
  if (m.predicate !== "event" || !LIVE_SOURCE.includes(m.status) || !isResolved(m.time)) return NO_MOMENTS;
  const t = m.time;
  const { root, depth, occurrenceKey } = occasionRoot(m, rows);
  if (occurrenceKey === null) return NO_MOMENTS;
  const id = (kind: MomentKind) => momentIdOf(hasher, root.logicalId, kind, occurrenceKey);
  const start = msFromTs(t.start);
  const zone = t.zone;
  const plans: MomentPlan[] = [];
  const retired: string[] = [];

  if (t.precision === "instant") {
    const day = t.civilStart.slice(0, 10);
    const earliest = localMinuteAt(day, WISH_EARLIEST_MINUTE, zone);
    const latest = localMinuteAt(day, WISH_LATEST_MINUTE, zone);
    const wishAt = earliest === null || latest === null ? null : Math.max(earliest, Math.min(latest, start - WISH_LEAD_MS));
    if (wishAt !== null && wishAt < start) plans.push(plan(m, root.logicalId, "wish", occurrenceKey, depth, wishAt, start, wishLine(m, start, zone), hasher));
    else retired.push(id("wish"));
    const end = t.end === null ? start + OCCASION_DEFAULT_MINUTES * 60_000 : Math.max(start, msFromTs(t.end));
    plans.push(plan(m, root.logicalId, "checkIn", occurrenceKey, depth, end + CHECKIN_AFTER_END_MS, end + OUTCOME_CLOSE_DAYS * DAY_MS, checkInLine(m), hasher));
    return { plans, retired };
  }

  // A day-only date: 08:00 is at or after the day's start, so the wish is always skipped.
  retired.push(id("wish"));
  const lastDay = (t.civilEnd ?? t.civilStart).slice(0, 10);
  const checkAt = localMinuteAt(lastDay, CHECKIN_DAY_MINUTE, zone);
  const closeAt = localMinuteAt(addCivilDays(lastDay, 1 + OUTCOME_CLOSE_DAYS), 0, zone);
  if (checkAt === null || closeAt === null || checkAt < start) return { plans, retired: [...retired, id("checkIn")] };
  plans.push(plan(m, root.logicalId, "checkIn", occurrenceKey, depth, checkAt, closeAt, checkInLine(m), hasher));
  return { plans, retired };
}

/**
 * The hero pattern's insight (spec §5 Pattern, floor hero only): once the detector passes (an offer line exists), due
 * at local midnight after the window, unless another occurrence of the same rollup is due within the cooldown.
 * `earlierInsightDues` are the due times of the rollup's stored insight moments that weren't cancelled.
 */
export function derivePattern(result: PatternResult, earlierInsightDues: readonly { momentId: string; dueAt: number }[], hasher: Hasher): DeriveResult {
  if (heroOfferLine(result) === null) return NO_MOMENTS;
  const w = result.window;
  const rollupId = heroRollupId(hasher);
  const key = w.toCivil;
  const momentId = momentIdOf(hasher, rollupId, "insight", key);
  const dueAt = localMinuteAt(addCivilDays(w.toCivil, 1), 0, w.zone);
  if (dueAt === null) return NO_MOMENTS;
  const cooling = earlierInsightDues.some((e) => e.momentId !== momentId && e.dueAt <= dueAt && dueAt - e.dueAt < INSIGHT_COOLDOWN_DAYS * DAY_MS);
  if (cooling) return NO_MOMENTS;
  return {
    plans: [
      {
        momentId,
        source: { kind: "rollup", id: rollupId },
        kind: "insight",
        occurrenceKey: key,
        scheduleRev: 0,
        dueAt,
        closeAt: dueAt + OTHER_CLOSE_DAYS * DAY_MS,
        domain: "money",
        subjectIds: ["self"],
        payload: { kind: "pattern", rollupId },
        noteRef: null,
        lineage: { rootKeys: result.rootKeys.slice(0, 128), rootSlices: [], dependsOn: [] },
      },
    ],
    retired: [],
  };
}

/** A loop's celebrate at `checkAt` (spec §5 Loop). Whether it speaks is the predicate's, at open. */
export function deriveLoop(m: Memory, hasher: Hasher): DeriveResult {
  const loop = m.loop;
  if (loop === null || m.status !== "active" || (loop.state !== "waiting" && loop.state !== "eligible")) return NO_MOMENTS;
  const checkAt = msFromTs(loop.checkAt);
  const key = civilDateAt(checkAt, loop.baseline.zone);
  return {
    plans: [
      {
        momentId: momentIdOf(hasher, m.logicalId, "celebrate", key),
        source: { kind: "memory", id: m.logicalId },
        kind: "celebrate",
        occurrenceKey: key,
        scheduleRev: m.scheduleRev,
        dueAt: checkAt,
        closeAt: checkAt + CELEBRATE_CLOSE_DAYS * DAY_MS,
        domain: "money",
        subjectIds: ["self"],
        payload: { kind: "celebrate", loopId: m.logicalId, before: null, after: null, delta: null, unit: "money", currency: loop.baseline.currency },
        noteRef: memoryRef(m),
        lineage: lineageOf(m),
      },
    ],
    retired: [],
  };
}

/**
 * A bounded fact or preference: one `expiryAsk` at `validTo` (spec §5 "Bounded fact or preference"). A rule or an
 * allergy never gets one: a bounded fact never applies to `core/rules`.
 */
export function deriveExpiry(m: Memory, zone: string, hasher: Hasher): DeriveResult {
  if (m.validTo === null || m.status !== "active" || m.kind === "rule" || m.predicate === "allergy") return NO_MOMENTS;
  if (m.kind !== "fact" && m.kind !== "preference") return NO_MOMENTS;
  const due = msFromTs(m.validTo);
  const key = civilDateAt(due, zone);
  return { plans: [plan(m, m.logicalId, "expiryAsk", key, 0, due, due + OTHER_CLOSE_DAYS * DAY_MS, expiryAskLine(m), hasher)], retired: [] };
}

/** A reminder written by the `makeReminder` executor: one `commitmentDue` at its time. */
export function deriveReminder(actionId: string, action: Extract<Ledger, { kind: "action" }>, hasher: Hasher): DeriveResult {
  const t = action.payload.time;
  if (action.payload.executor !== "makeReminder" || action.state !== "complete" || !isResolved(t)) return NO_MOMENTS;
  const due = t.precision === "instant" ? msFromTs(t.start) : localMinuteAt(t.civilStart.slice(0, 10), REMINDER_DAY_MINUTE, t.zone);
  if (due === null) return NO_MOMENTS;
  const key = t.civilStart;
  const ref: Ref = { type: "ledger", id: actionId, rev: action.rev };
  return {
    plans: [
      {
        momentId: momentIdOf(hasher, actionId, "commitmentDue", key),
        source: { kind: "action", id: actionId },
        kind: "commitmentDue",
        occurrenceKey: key,
        scheduleRev: 0,
        dueAt: due,
        closeAt: due + OTHER_CLOSE_DAYS * DAY_MS,
        domain: "time",
        subjectIds: ["self"],
        payload: { kind: "cue", noteRef: ref, template: { text: reminderLine(action.payload.note ?? "your reminder"), entityRefs: [], timeFields: [] } },
        noteRef: ref,
        // Brief 036 finding 10: the reminder keeps its source's lineage, and open rereads it.
        lineage: { rootKeys: action.rootKeys.slice(0, 128), rootSlices: action.rootSlices.slice(0, 128), dependsOn: action.dependsOn.slice(0, 256) },
      },
    ],
    retired: [],
  };
}
