import { type Card, type CoreEpoch, type Hasher, type Ledger, type PhoneActivity, type PhoneCompletion, type PhoneReport, type Session, type Turn, msFromTs, tsFromMs } from "@franki/core";
import { gateAudience } from "../audience";
import { narrowedHere } from "../audience-swap";
import { cFields } from "../records";
import { clearPrivateRows } from "../ledger/private-rows";
import type { RouteDeps } from "../routes/runtime";
import { paths } from "../store/paths";
import type { StorePort, Tx } from "../store/port";
import { carrierOf, phoneCompletion, storedPhoneStatus } from "./lifecycle";
import type { PhoneEntry } from "./outbound";

type ReportEntry = Extract<Ledger, { kind: "phoneReport" }>;
export const PHONE_REPORT_WINDOW_MS = 60 * 60_000;
const reportId = (uid: string, dialId: string, hasher: Hasher) => hasher.id(["phone-report", uid, dialId]);
export const reportPath = (uid: string, dialId: string, hasher: Hasher) => paths.ledger(uid, reportId(uid, dialId, hasher));

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

/** `callId` null files a report for a dial that no SIP leg ever reached; its caller checks the carrier first. */
export async function savePhoneReport(tx: Tx, deps: RouteDeps, uid: string, dialId: string, callId: string | null, report: PhoneReport): Promise<boolean> {
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

export interface PhoneResult {
  completion: PhoneCompletion;
  report: PhoneReport | null;
}

/** Called in the same transaction as reply admission, under the original session's audience and retention checks. */
export async function readPhoneResult(tx: Tx, deps: RouteDeps, uid: string, sessionId: string, session: Session, epoch: number, dialId?: string): Promise<PhoneResult | null> {
  const now = deps.clock.read().opsClock.now;
  if (!canReadPhone(session, now)) return null;
  let result: Awaited<ReturnType<typeof resultForDial>>;
  if (dialId !== undefined) {
    const doc = await tx.get<PhoneEntry>(paths.ledger(uid, dialId));
    result = doc ? await resultForDial(tx, deps, uid, sessionId, epoch, now, dialId, doc.data) : null;
  } else {
    const results = await recentPhoneResults(tx, deps, uid, sessionId, epoch, now, 1, "at");
    result = results[0] ?? null;
  }
  return result ? { completion: result.completion, report: result.report } : null;
}

const noReportLines: Record<Exclude<PhoneCompletion, "reported">, string> = {
  active: "The call is still in progress. I don’t have a report yet.",
  awaitingReport: "The call has ended. I’m still waiting for the phone specialist’s report.",
  unconfirmed: "The call ended. I don’t have a confirmed outcome to share.",
  noAnswer: "The call rang out with no answer.",
  busy: "The line was busy.",
  failed: "The call did not go through.",
  unknown: "I couldn’t confirm the call’s status.",
};

export function phoneResultLine(result: PhoneResult | null): string {
  if (result?.report) return `Phone specialist (${result.report.outcome}): ${result.report.summary}`;
  return result && result.completion !== "reported" ? noReportLines[result.completion] : "I don’t have a confirmed report from this call.";
}

function canReadPhone(session: Session, now: number) {
  const { audience, modifiers } = gateAudience(session, now);
  return audience === "private" && !modifiers.crisis && !narrowedHere(session);
}

/** Start with the carrier record so a long call can end after its private report slot expires. */
async function recentPhoneResults(tx: Tx, deps: RouteDeps, uid: string, sessionId: string, epoch: number, now: number, limit: number, order: "at" | "updatedAt") {
  const docs = await tx.query<PhoneEntry>({
    collection: paths.collection(uid, "ledger"), where: [
      { field: "kind", op: "==", value: "phoneCall" }, { field: "payload.sessionId", op: "==", value: sessionId },
    ], orderBy: { field: order, dir: "desc" }, limit,
  });
  const results = await Promise.all(docs.sort((a, b) => b.data.at.localeCompare(a.data.at)).map(({ id, data }) =>
    resultForDial(tx, deps, uid, sessionId, epoch, now, id, data)));
  return results.filter((r) => r !== null);
}

async function resultForDial(tx: Tx, deps: RouteDeps, uid: string, sessionId: string, epoch: number, now: number, dialId: string, dial: PhoneEntry) {
  if (dial.kind !== "phoneCall" || dial.epoch !== epoch || dial.payload.sessionId !== sessionId ||
      now - msFromTs(carrierOf(dial)?.observedAt ?? dial.at) >= PHONE_REPORT_WINDOW_MS) return null;
  const id = reportId(uid, dialId, deps.hasher);
  const withinReportWindow = now - msFromTs(dial.at) < PHONE_REPORT_WINDOW_MS;
  const slot = withinReportWindow ? (await tx.get<ReportEntry>(paths.ledger(uid, id)))?.data : null;
  const report = slot?.kind === "phoneReport" && slot.epoch === epoch && slot.payload.sessionId === sessionId &&
    slot.payload.turnId === dial.payload.turnId && slot.retainUntil !== null && msFromTs(slot.retainUntil) > now
    ? slot.payload.report : null;
  const state = phoneCompletion(dial, report, now);
  const completion = state === "awaitingReport" && !withinReportWindow ? "unconfirmed" : state;
  return { id, completion, report, dialId, dial, status: storedPhoneStatus(dial, now) };
}

/** The screen and live voice share one read. Only carrier state and report availability enter a future voice reply. */
export async function phoneStateView(tx: Tx, deps: RouteDeps, uid: string, sessionId: string, session: Session, epoch: number, activity: boolean) {
  const now = deps.clock.read().opsClock.now;
  const results = canReadPhone(session, now)
    ? await recentPhoneResults(tx, deps, uid, sessionId, epoch, now, 4, activity ? "updatedAt" : "at")
    : [];
  const phoneActivity: PhoneActivity[] = results.map(({ dialId, dial, status, completion, report }) => ({ dialId, turnId: dial.payload.turnId, status, completion, hasReport: report !== null }));
  const cards = results.flatMap((result): Card[] => {
    const { id, report, completion } = result;
    if (report) return [{ id, kind: "source", title: report.outcome === "voicemail" ? "Phone call · voicemail" : report.outcome === "inconclusive" ? "Phone call · inconclusive" : "Phone call · answer", lines: [report.summary], sens: "S2", sources: [] }];
    if (completion === "active" || completion === "unknown" || completion === "awaitingReport") return [];
    return [{ id, kind: "source", title: "Phone call", lines: [phoneResultLine(result)], sens: "S2", sources: [] }];
  });
  return { cards, phoneActivity, checks: activity ? results.map(({ dialId, dial }) => ({ dialId, dial })) : [] };
}

export async function phoneReportCards(tx: Tx, deps: RouteDeps, uid: string, sessionId: string, session: Session, epoch: number): Promise<Card[]> {
  return (await phoneStateView(tx, deps, uid, sessionId, session, epoch, false)).cards;
}

/** The same ledger kind/time index used for phone status. A forget drains all matching rows under its write barrier. */
export async function clearPhoneReports(store: StorePort, uid: string, expiredAt?: number) {
  await clearPrivateRows(store, uid, "phoneReport", expiredAt === undefined ? undefined : expiredAt - PHONE_REPORT_WINDOW_MS);
}
