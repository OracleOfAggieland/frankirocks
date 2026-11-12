/**
 * The hero fixture over the routes, for brief 042 item 1: open sessions, record the offer as shown through the receipt
 * route, commit turns, and answer through the tool route.
 */
import { type CoreState, type Ledger, buildSlice } from "@franki/core";
import { HERO_BASELINE_GROCERIES, HERO_COVERAGE, HERO_MEETINGS, HERO_ORDERS, HERO_ZONE, instantAt, sampleEvidence, testId } from "@franki/core/testing";
import { ensureCoreDocs } from "../core-docs";
import { receiptRoute } from "../routes/receipt";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { callRoute, testRig } from "./fakes";
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
  const show = async (s: OpenedSession, pendingId: string) => {
    rig.clock.advance(10);
    const res = await callRoute(rig, receiptRoute, { requestId: testId(`show${++r}`), stamp: { ...s.stamp, turnId: testId(`show-turn-${r}`) }, responseId: `resp_show_${r}`, kind: "pendingRendered", momentIds: [], noteIds: [], pendingId, permitKind: null, text: null });
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    rig.clock.advance(10);
  };
  let t = 0;
  const say = async (s: OpenedSession, seq: number, text: string) => {
    const res = await callRoute(rig, turnRoute, { ...asrTurn(s.stamp, seq, text, [{ itemId: `item_${++t}`, commitSeq: seq }], "final", `t${t}`), judge: "O" });
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    return { ...s.stamp, turnId: testId(`turn-t${t}`) };
  };
  let k = 0;
  const answer = (stamp: unknown, o: { pendingId: string; yesId: string }) =>
    callRoute(rig, toolRoute, { requestId: testId(`tool${++k}`), stamp, callId: `call_${k}`, tool: { name: "answer", args: { pendingId: o.pendingId, choiceId: o.yesId } } });
  const actions = async () =>
    (await rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).filter((d) => d.data.kind === "action").length;
  return { rig, ctx, open, show, say, answer, actions };
}

