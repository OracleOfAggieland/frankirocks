/**
 * The Session's audience and parse gap (voice-control R4.2, R15; design "Audience effects", question 80).
 *
 * While a Parse_Repair or a Superseding_Post is pending, `Session.parseLease` names the failed Turn and the
 * Effective_Audience is `unknown`; the stored audience is untouched, so a repair that succeeds leaves no trace. A
 * lease whose time ran out with no repair is a failed repair: the next request that sees it stores `unknown`.
 */
import { type Au, type ID, type Session, type Turn, msFromTs, tsFromMs } from "@franki/core";
import { paths } from "./store/paths";
import type { Tx } from "./store/port";

/** A failed parse's repair window (R15.3). */
export const REPAIR_LEASE_MS = 2_500;
/** A missing transcript's window for its Superseding_Post (R15.7). */
export const MISSING_LEASE_MS = 10_000;

export function effectiveAudience(s: Session, opsNow: number): Au {
  return s.parseLease !== null && msFromTs(s.parseLease.until) > opsNow ? "unknown" : s.audience;
}

/** A Parse_Gap: an earlier user Turn whose parse never committed (contracts §6 "Failedsequence advances processing only"). */
export const hasParseGap = (s: Session): boolean => s.committedParseSeq < s.lastClientSeq;

/** An expired lease is a failed repair: `unknown` until a parsed alone, and the lease cleared. */
export function expireLease(s: Session, opsNow: number): Session {
  if (s.parseLease === null || msFromTs(s.parseLease.until) > opsNow) return s;
  return { ...s, audience: "unknown", parseLease: null };
}

/**
 * The audience effect of a Turn whose parse didn't commit. A missing transcript or a deadline or transport failure
 * opens a lease (unless one is already held, which stores `unknown`), and so does an invalid answer; anything else (oversize, a
 * failed transcript) stores `unknown` at once.
 */
export function failedParseEffect(s: Session, f: { clientSeq: number; token: ID; why: "missing" | "failedTranscript" | "deadline" | "transport" | "invalid" | "oversize" }, opsNow: number): Session {
  // An invalid answer is repaired like a deadline or transport failure; oversize is not (review of the live run, item 4).
  const leaseMs = f.why === "missing" ? MISSING_LEASE_MS : f.why === "deadline" || f.why === "transport" || f.why === "invalid" ? REPAIR_LEASE_MS : null;
  if (leaseMs === null || (s.parseLease !== null && msFromTs(s.parseLease.until) > opsNow)) return { ...s, audience: "unknown" };
  return { ...s, parseLease: { clientSeq: f.clientSeq, token: f.token, until: tsFromMs(opsNow + leaseMs) } };
}

/**
 * The parse watermark after the Turn at `seq` commits its parse late (a Parse_Repair or a Superseding_Post): it
 * moves over every contiguous committed user Turn from the current watermark (question 73; design "The
 * Parse_Repair"). `seq` itself counts as committed, since its update is in the same transaction and not yet read.
 */
export async function advancedWatermark(tx: Pick<Tx, "query">, uid: string, sessionId: ID, s: Session, seq: number): Promise<number> {
  let w = s.committedParseSeq;
  if (seq !== w + 1) return w;
  const rows = await tx.query<Turn>({
    collection: paths.turns(uid, sessionId),
    where: [{ field: "seq", op: ">=", value: w + 1 }],
    orderBy: { field: "seq", dir: "asc" },
    limit: 100,
  });
  const committed = new Set(rows.filter((r) => r.data.role === "user" && r.data.parseState === "committed").map((r) => r.data.seq));
  committed.add(seq);
  while (committed.has(w + 1) && w + 1 <= s.lastClientSeq) w++;
  return w;
}
