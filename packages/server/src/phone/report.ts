import { type Card, type CoreEpoch, type Hasher, type Ledger, type PhoneReport, type Session, type Turn, msFromTs, tsFromMs } from "@franki/core";
import { gateAudience } from "../audience";
import { narrowedHere } from "../audience-swap";
import { cFields } from "../records";
import type { RouteDeps } from "../routes/runtime";
import { paths } from "../store/paths";
import type { StorePort, Tx } from "../store/port";

type ReportEntry = Extract<Ledger, { kind: "phoneReport" }>;
export const PHONE_REPORT_WINDOW_MS = 60 * 60_000;
const reportPath = (uid: string, dialId: string, hasher: Hasher) => paths.ledger(uid, hasher.id(["phone-report", uid, dialId]));

/** Each accepted dial owns one result slot, including when two assignments overlap. */
export function startPhoneReport(tx: Tx, uid: string, dialId: string, hasher: Hasher, call: Extract<Ledger, { kind: "phoneCall" }>) {
  const { sessionId, turnId } = call.payload;
  const path = reportPath(uid, dialId, hasher);
  const entry: ReportEntry = {
    ...cFields(uid, call.at, call.epoch, call.policyRev), kind: "phoneReport", state: "pending", at: call.at,
    retainUntil: tsFromMs(msFromTs(call.at) + PHONE_REPORT_WINDOW_MS), payload: { sessionId, turnId, report: null },
  };
  tx.create(path, entry);
}

export async function savePhoneReport(tx: Tx, deps: RouteDeps, uid: string, dialId: string, callId: string, report: PhoneReport): Promise<boolean> {
  const dial = (await tx.get<Extract<Ledger, { kind: "phoneCall" }>>(paths.ledger(uid, dialId)))?.data;
  if (!dial || dial.kind !== "phoneCall" || dial.payload.realtimeCallId !== callId || dial.state === "failed") return false;
  const { sessionId, turnId } = dial.payload;
  const path = reportPath(uid, dialId, deps.hasher);
  const [slot, epoch, turn] = await Promise.all([
    tx.get<ReportEntry>(path), tx.get<CoreEpoch>(paths.core(uid, "epoch")),
    tx.get<Turn>(paths.turn(uid, sessionId, turnId)),
  ]);
  const now = deps.clock.read().opsClock.now;
  if (!slot || slot.data.payload.turnId !== turnId || !slot.data.retainUntil || msFromTs(slot.data.retainUntil) <= now ||
      !epoch || epoch.data.barrier !== null || epoch.data.epoch !== dial.epoch ||
      !turn || turn.data.state === "dead" || turn.data.sourceClass !== "U" || !turn.data.text) return false;
  const prior = slot.data.payload.report;
  if (prior) return prior.outcome === report.outcome && prior.summary === report.summary;
  tx.update(path, { ...slot.data, updatedAt: tsFromMs(now), state: "complete", payload: { sessionId, turnId, report } } satisfies ReportEntry);
  return true;
}

/** Called inside the same transaction as reply admission. Only the original private conversation can read its report. */
export async function readPhoneReport(tx: Tx, deps: RouteDeps, uid: string, sessionId: string, session: Session, epoch: number): Promise<PhoneReport | null> {
  const rows = await recentReports(tx, deps, uid, sessionId, session, epoch, 1);
  return rows[0]?.data.payload.report ?? null;
}

async function recentReports(tx: Tx, deps: RouteDeps, uid: string, sessionId: string, session: Session, epoch: number, limit: number) {
  const now = deps.clock.read().opsClock.now;
  const { audience, modifiers } = gateAudience(session, now);
  if (audience !== "private" || modifiers.crisis || narrowedHere(session)) return [];
  const docs = await tx.query<ReportEntry>({
    collection: paths.collection(uid, "ledger"), where: [
      { field: "kind", op: "==", value: "phoneReport" }, { field: "payload.sessionId", op: "==", value: sessionId },
      { field: "at", op: ">", value: tsFromMs(now - PHONE_REPORT_WINDOW_MS) },
    ], orderBy: { field: "at", dir: "desc" }, limit,
  });
  return docs.filter(({ data }) => data.epoch === epoch && data.retainUntil !== null && msFromTs(data.retainUntil) > now);
}

export async function phoneReportCards(tx: Tx, deps: RouteDeps, uid: string, sessionId: string, session: Session, epoch: number): Promise<Card[]> {
  const rows = await recentReports(tx, deps, uid, sessionId, session, epoch, 4);
  return rows.flatMap(({ id, data }): Card[] => {
    const report = data.payload.report;
    return report ? [{ id, kind: "source", title: report.outcome === "voicemail" ? "Phone call · voicemail" : report.outcome === "inconclusive" ? "Phone call · inconclusive" : "Phone call · answer", lines: [report.summary], sens: "S2", sources: [] }] : [];
  });
}

/** The same ledger kind/time index used for phone status. A forget drains all matching rows under its write barrier. */
export async function clearPhoneReports(store: StorePort, uid: string, expiredAt?: number) {
  const pageSize = 100;
  let count: number;
  do {
    count = await store.transaction(uid, async (tx) => {
      const rows = await tx.query<ReportEntry>({
        collection: paths.collection(uid, "ledger"),
        where: [{ field: "kind", op: "==", value: "phoneReport" }, ...(expiredAt === undefined ? [] : [{ field: "at", op: "<=" as const, value: tsFromMs(expiredAt - PHONE_REPORT_WINDOW_MS) }])],
        orderBy: { field: "at", dir: "desc" }, limit: pageSize,
      });
      for (const row of rows) tx.delete(row.path);
      return rows.length;
    });
  } while (expiredAt === undefined && count === pageSize);
}
