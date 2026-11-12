/**
 * Brief 040, item 2: the hero offer, one Session and the owner's turns, for the `answer` tool as a call sends it
 * (both IDs null, code decides). Test-only. The same fixture as `tool-food.review.test.ts`'s setup, with the
 * offer's `pendingRendered` row recorded before the turn `present` names.
 */
import { type CoreState, type Ledger, buildSlice } from "@franki/core";
import { HERO_BASELINE_GROCERIES, HERO_COVERAGE, HERO_MEETINGS, HERO_ORDERS, HERO_ZONE, instantAt, sampleEvidence, testId } from "@franki/core/testing";
import { ensureCoreDocs } from "../core-docs";
import { toolRoute } from "../routes/tool";
import { heroOffer } from "../routes/tool-food";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { recordPendingRendered } from "../time/reminder";
import { callRoute, testRig } from "./fakes";
import { asrTurn, openTestSession } from "./session-fixtures";

export const ANSWER_UID = "owner-1";
const UID = ANSWER_UID;

/**
 * The hero fixture, one Session, and the turns given (each a user turn, in order). `present` is the index of the turn
 * the offer is recorded as shown just before, or null for never.
 */
export async function answerCallSetup(opts: { turns: readonly string[]; present: number | null }) {
  const rig = testRig();
  rig.clock.setWorld(instantAt("2026-10-26", 12 * 60, HERO_ZONE));
  await ensureCoreDocs(UID, rig.deps);
  await rig.store.transaction(UID, async (tx) => {
    const state = await tx.get<CoreState>(paths.core(UID, "state"));
    tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE, coverage: HERO_COVERAGE });
  });
  await rig.store.transaction(UID, async (tx) => {
    for (const r of [...HERO_ORDERS, ...HERO_BASELINE_GROCERIES, ...HERO_MEETINGS] as { id: string; rootKey: string; bank?: unknown; calendar?: unknown }[]) {
      const kind = r.bank !== undefined ? "transaction" : "calendar";
      const text = `${kind} ${r.id}`;
      const slice = buildSlice({ eid: r.id, fieldPath: "text", fieldText: text, start: 0, end: text.length, class: "O", sens: "S1" }, rig.deps.hasher);
      tx.create(
        paths.evidence(UID, r.id),
        sampleEvidence({ logicalId: r.id, kind, source: kind === "transaction" ? "plaid" : "calendar", observation: (r.bank ?? r.calendar) as never, rootKeys: [r.rootKey], text: { kind: "inline", text }, fieldSlices: [slice] }),
      );
    }
  });
  const s = await openTestSession(rig);
  await rig.store.transaction(UID, async (tx) => {
    const state = await tx.get<CoreState>(paths.core(UID, "state"));
    tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE });
  });
  const ctx = { uid: UID, deps: rig.deps, schedule: rig.sched.schedule };
  const offer = await heroOffer(ctx, s.stamp.generation);
  for (const [i, text] of opts.turns.entries()) {
    if (opts.present === i && offer !== null) {
      rig.clock.advance(10);
      await rig.store.transaction(UID, (tx) => recordPendingRendered(tx, UID, offer.pendingId as never, rig.deps.clock.read().opsClock.now, rig.deps.hasher));
      rig.clock.advance(10);
    }
    const res = await callRoute(rig, turnRoute, { ...asrTurn(s.stamp, i + 1, text, [{ itemId: `item_${i + 1}`, commitSeq: i + 1 }]), judge: "O" });
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  }
  const stamp = { ...s.stamp, turnId: testId(`turn-${opts.turns.length}`) };
  let n = 0;
  const tool = (t: Record<string, unknown>) => callRoute(rig, toolRoute, { requestId: testId(`tool${++n}`), stamp, callId: "call_1", tool: t });
  const actions = async () =>
    (await rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).filter((d) => d.data.kind === "action");
  return { rig, ctx, stamp, offer, tool, actions };
}

/** What a call sends for `answer`: both IDs null (brief 040, item 2). */
export const CALL_ANSWER = { name: "answer", args: { pendingId: null, choiceId: null } } as const;
