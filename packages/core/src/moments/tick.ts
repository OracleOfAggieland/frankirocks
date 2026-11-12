/**
 * The tick's plan (brief 023 task 4; spec §5 Triggers; contracts Q15, Q16, Q35, tickUser; design note 023 §3). Pure:
 * stored moments, the two clocks and two reread verdicts in, transitions out, in the order (dueAt, momentId).
 *
 * Each moment's open is decided by its own due time, never by when the tick ran: a moment whose window both opens and
 * closes before `worldNow` is reported as opened, then closed. So one tick at T (a jump) opens the same moments in
 * the same order as ticking each minute to T. The server applies one moment's transitions per transaction, after
 * rereading it, and calls this again on the reread row.
 */
import { msFromTs } from "../schema/primitives";
import type { Memory, Moment, MomentKind, MomentStatus } from "../schema/records";
import { OPEN_LEASE_MS } from "./constants";
import { isResolved } from "./derive";

export interface TickRow {
  id: string;
  kind: MomentKind;
  status: MomentStatus;
  dueAt: number;
  closeAt: number;
  leaseUntil: number | null;
}

/** What a reread of the moment's source says: speak, cancel, or cancel because it was forgotten. */
export type SourceVerdict = "ok" | "gone" | "forgotten";

export interface TickInput {
  rows: readonly TickRow[];
  worldNow: number;
  opsNow: number;
  source: (momentId: string) => SourceVerdict;
  /** A celebrate's predicate at open (spec §5 Loop: a miss stays silent). Ignored for other kinds. */
  passes: (momentId: string) => boolean;
}

export type Transition =
  | { momentId: string; to: "pending"; why: "leaseExpired" }
  | { momentId: string; to: "leased"; why: "due" }
  | { momentId: string; to: "cancelled"; why: "policy" | "forgotten" }
  | { momentId: string; to: "skipped"; why: "startPassed" | "predicateMiss" }
  | { momentId: string; to: "expired"; why: "closed" };

export const tickRowOf = (id: string, m: Moment): TickRow => ({
  id,
  kind: m.kind,
  status: m.status,
  dueAt: msFromTs(m.dueAt),
  closeAt: msFromTs(m.closeAt),
  leaseUntil: m.leaseUntil === null ? null : msFromTs(m.leaseUntil),
});

/**
 * A source Memory reread at open. Blocked means forgotten. A source must still be current (`active` or `scheduled`)
 * and clean; an occasion's time must still be resolved; a loop must still be waiting or eligible.
 */
export function sourceVerdict(m: Memory | null): SourceVerdict {
  if (m === null) return "gone";
  if (m.status === "blocked") return "forgotten";
  if (m.status !== "active" && m.status !== "scheduled") return "gone";
  if (m.dirty || !m.dependenciesComplete) return "gone";
  if (m.predicate === "event" && !isResolved(m.time)) return "gone";
  if (m.loop !== null && m.loop.state !== "waiting" && m.loop.state !== "eligible") return "gone";
  return "ok";
}

function rowTransitions(r: TickRow, input: TickInput): Transition[] {
  const out: Transition[] = [];
  const { worldNow, opsNow } = input;
  let status = r.status;
  if (status === "leased" && r.leaseUntil !== null && r.leaseUntil <= opsNow) {
    out.push({ momentId: r.id, to: "pending", why: "leaseExpired" });
    status = "pending";
  }
  if (status === "pending" && r.dueAt <= worldNow) {
    const verdict = input.source(r.id);
    if (verdict !== "ok") return [...out, { momentId: r.id, to: "cancelled", why: verdict === "forgotten" ? "forgotten" : "policy" }];
    if (r.dueAt < r.closeAt) {
      if (r.kind === "celebrate" && !input.passes(r.id)) return [...out, { momentId: r.id, to: "skipped", why: "predicateMiss" }];
      out.push({ momentId: r.id, to: "leased", why: "due" });
      status = "leased";
    }
  }
  if ((status === "pending" || status === "leased" || status === "admitted") && r.closeAt <= worldNow && r.dueAt <= worldNow) {
    out.push(r.kind === "wish" && status !== "admitted" ? { momentId: r.id, to: "skipped", why: "startPassed" } : { momentId: r.id, to: "expired", why: "closed" });
  }
  return out;
}

export function planTick(input: TickInput): Transition[] {
  const rows = [...input.rows].sort((a, b) => a.dueAt - b.dueAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows.flatMap((r) => rowTransitions(r, input));
}

/** The opened moment IDs of a plan, in order. */
export const openedIds = (ts: readonly Transition[]): string[] => ts.filter((t) => t.to === "leased").map((t) => t.momentId);

/** Applies transitions to tick rows (the pure model of what the server writes). */
export function applyTransitions<R extends TickRow>(rows: readonly R[], ts: readonly Transition[], opsNow: number): R[] {
  const out = new Map(rows.map((r) => [r.id, { ...r }]));
  for (const t of ts) {
    const r = out.get(t.momentId);
    if (r === undefined) continue;
    r.status = t.to;
    r.leaseUntil = t.to === "leased" ? opsNow + OPEN_LEASE_MS : null;
  }
  return rows.map((r) => out.get(r.id)!);
}
