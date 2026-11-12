/**
 * Reads the hero's numbers back out of seeded Evidence (brief 019 "Sources hold"). A fixture check for tests and the
 * report, not the pattern detector (brief 022 builds `takeout_late_meeting_v1`). It follows spec §10's rules so the
 * fixture is known to satisfy them: posted takeout purchases from bank rows, an evening local purchase instant, and
 * an accepted, confirmed, opaque, timed meeting starting at or after 18:00 on the same local date. Every number
 * names the rows it came from.
 */
import type { Evidence } from "@franki/core";
import { msFromTs } from "@franki/core";
import { localDate, localMinute } from "./clock";

/** A purchase at or after this local minute is an evening purchase. */
export const EVENING_FROM_MINUTE = 17 * 60;
/** A meeting starting at or after this local minute is a late meeting. */
export const LATE_MEETING_FROM_MINUTE = 18 * 60;

export interface HeroPurchase {
  eid: string;
  cents: number;
  date: string;
  merchant: string | null;
  /** The calendar Evidence that makes this a late-meeting night, or null. */
  meetingEid: string | null;
}

export interface HeroSources {
  coveredDates: number;
  purchases: HeroPurchase[];
  totalCents: number;
  lateCount: number;
  lateCents: number;
}

export function heroSources(rows: readonly { id: string; data: Evidence }[], window: { from: string; to: string }, zone: string): HeroSources {
  const inWindow = (d: string) => d >= window.from && d <= window.to;
  const bank = rows.filter((r) => r.data.status === "retained" && r.data.isCurrentProvider && r.data.observation.kind === "bank");
  const covered = new Set<string>();
  for (const r of bank) {
    const o = r.data.observation;
    if (o.kind !== "bank" || o.removed || o.purchaseAt.instant === null) continue;
    const d = localDate(msFromTs(o.purchaseAt.instant), zone);
    if (inWindow(d)) covered.add(d);
  }
  const lateMeetings = new Map<string, string>();
  for (const r of rows) {
    const o = r.data.observation;
    if (r.data.status !== "retained" || !r.data.isCurrentProvider || o.kind !== "calendar") continue;
    if (o.status !== "confirmed" || o.selfResponse !== "accepted" || o.transparency !== "opaque" || o.allDay) continue;
    const start = msFromTs(o.start);
    if (localMinute(start, zone) < LATE_MEETING_FROM_MINUTE) continue;
    const d = localDate(start, zone);
    if (!lateMeetings.has(d) || r.id < lateMeetings.get(d)!) lateMeetings.set(d, r.id);
  }
  const purchases: HeroPurchase[] = [];
  for (const r of bank) {
    const o = r.data.observation;
    if (o.kind !== "bank" || o.category !== "takeout" || o.pending || o.removed || o.postedAt === null) continue;
    if (o.purchaseAt.instant === null || o.purchaseAt.precision !== "instant") continue;
    const at = msFromTs(o.purchaseAt.instant);
    const date = localDate(at, zone);
    if (!inWindow(date)) continue;
    const evening = localMinute(at, zone) >= EVENING_FROM_MINUTE;
    purchases.push({ eid: r.id, cents: -o.amountCents, date, merchant: r.data.title, meetingEid: evening ? (lateMeetings.get(date) ?? null) : null });
  }
  purchases.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.eid < b.eid ? -1 : 1));
  const late = purchases.filter((p) => p.meetingEid !== null);
  return {
    coveredDates: covered.size,
    purchases,
    totalCents: purchases.reduce((n, p) => n + p.cents, 0),
    lateCount: late.length,
    lateCents: late.reduce((n, p) => n + p.cents, 0),
  };
}

/**
 * True when a thread's latest message is not from the Owner: code thread ordering (contracts §5 "awaitingReply"),
 * never a model's reading.
 */
export function awaitingReply(rows: readonly { id: string; data: Evidence }[], threadKey: string): boolean {
  const thread = rows
    .filter((r) => r.data.kind === "message" && r.data.threadKey === threadKey && r.data.status === "retained")
    .sort((a, b) => (a.data.occurredAt < b.data.occurredAt ? -1 : a.data.occurredAt > b.data.occurredAt ? 1 : 0));
  const last = thread.at(-1);
  return last !== undefined && last.data.authorship !== "self";
}
