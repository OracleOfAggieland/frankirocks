/**
 * The hero fixture over the routes, for brief 042 item 1: open sessions, record the offer as shown through the receipt
 * route, commit turns, and answer through the tool route.
 */
import { type CoreState, type ID, type Ledger, type Proactive, buildSlice } from "@franki/core";
import { HERO_BASELINE_GROCERIES, HERO_COVERAGE, HERO_MEETINGS, HERO_ORDERS, HERO_ZONE, instantAt, sampleEvidence, testId } from "@franki/core/testing";
import { ensureCoreDocs } from "../core-docs";
import { openRoute } from "../routes/open";
import { receiptRoute } from "../routes/receipt";
import { recordShowing } from "../time/reminder";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { callRoute, testRig } from "./fakes";
import { meetAlreadyHappened } from "./meet";
import { type OpenedSession, asrTurn, openTestSession } from "./session-fixtures";

export const UID = "owner-1";
type Row = { id: string; rootKey: string; bank?: unknown; calendar?: unknown };

async function insertHeroRows(rig: ReturnType<typeof testRig>, rows: readonly Row[]) {
  await rig.store.transaction(UID, async (tx) => {
    for (const r of rows) {
      const kind = r.bank !== undefined ? "transaction" : "calendar";
      const text = `${kind} ${r.id}`;
      const slice = buildSlice({ eid: r.id, fieldPath: "text", fieldText: text, start: 0, end: text.length, class: "O", sens: "S1" }, rig.deps.hasher);
      tx.create(
        paths.evidence(UID, r.id),
        sampleEvidence({ logicalId: r.id, kind, source: kind === "transaction" ? "plaid" : "calendar", observation: (r.bank ?? r.calendar) as never, rootKeys: [r.rootKey], text: { kind: "inline", text }, fieldSlices: [slice] }),
      );
    }
  });
}

export async function hero() {
  const rig = testRig();
  rig.clock.setWorld(instantAt("2026-10-26", 12 * 60, HERO_ZONE));
  await ensureCoreDocs(UID, rig.deps);
  // Brief 052: the hero offer is the opening line under test, so the first meeting is already over.
  await meetAlreadyHappened(rig.store, UID, rig.deps.hasher);
  await rig.store.transaction(UID, async (tx) => {
    const state = await tx.get<CoreState>(paths.core(UID, "state"));
    tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE, coverage: HERO_COVERAGE });
  });
  await insertHeroRows(rig, [...HERO_ORDERS, ...HERO_BASELINE_GROCERIES, ...HERO_MEETINGS]);
  const ctx = { uid: UID, deps: rig.deps, schedule: rig.sched.schedule };
  let n = 0;
  const open = async () => {
    const s = await openTestSession(rig, `open${++n}`);
    await rig.store.transaction(UID, async (tx) => {
      const state = await tx.get<CoreState>(paths.core(UID, "state"));
      tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE });
    });
    return s;
  };
  let r = 0;
  // Setup: the offer recorded as shown in this Session, as the receipt route records a line heard to the end. Brief
  // 045 findings 7 and 12: a client's `pendingRendered` naming a pending ID no longer shows anything, so this writes
  // the showing row directly, once per call (each call stands for one response).
  const show = async (s: OpenedSession, pendingId: string) => {
    rig.clock.advance(10);
    const responseId = `resp_show_${++r}`;
    await rig.store.transaction(UID, (tx) => recordShowing(tx, UID, pendingId as ID, s.sessionId, rig.deps.clock.read().opsClock.now, rig.deps.hasher, responseId));
    rig.clock.advance(10);
  };
  let t = 0;
  const say = async (s: OpenedSession, seq: number, text: string, judge: "O" | "H" | "U" | "timeout" = "O") => {
    const res = await callRoute(rig, turnRoute, { ...asrTurn(s.stamp, seq, text, [{ itemId: `item_${++t}`, commitSeq: seq }], "final", `t${t}`), judge });
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    return { ...s.stamp, turnId: testId(`turn-t${t}`) };
  };
  let k = 0;
  const answer = (stamp: unknown, o: { pendingId: string; yesId: string }) =>
    callRoute(rig, toolRoute, { requestId: testId(`tool${++k}`), stamp, callId: `call_${k}`, tool: { name: "answer", args: { pendingId: o.pendingId, choiceId: o.yesId } } });
  const actions = async () =>
    (await rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).filter((d) => d.data.kind === "action").length;
  /** An open through the route, with the line delivery chose for it (or null). */
  const openLine = async (): Promise<{ s: OpenedSession; proactive: Proactive | null }> => {
    const res = await callRoute(rig, openRoute, { requestId: testId(`open${++n}`), initiator: "user", previousSessionId: null, clientZone: HERO_ZONE, visitId: null });
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    const d = res.body.deck;
    const s: OpenedSession = { sessionId: res.body.sessionId, deck: d, stamp: { sessionId: res.body.sessionId, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: 1 } };
    return { s, proactive: res.body.proactive ?? null };
  };
  /** A voice client's receipt for a played Proactive, on one response. */
  const played = (p: Proactive, responseId: string) => async (kind: "admitted" | "playbackStarted" | "playbackEnded" | "cancelled" | "transcript", text: string | null = null) => {
    rig.clock.advance(10);
    const res = await callRoute(rig, receiptRoute, { requestId: testId(`rc${++r}`), stamp: p.permit.stamp, responseId, kind, momentIds: p.permit.momentIds, noteIds: p.permit.noteIds, pendingId: null, permitKind: kind === "admitted" ? "proactive" : null, text });
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  };
  return { rig, ctx, open, openLine, played, show, say, answer, actions };
}

