// The reviewer's inputs for brief 037's server findings (1, 2, 4's binding, 6, 10's sources, 11), one block each.
import { type CoreRules, type CoreState, type Ledger, buildSlice, heroOfferCardLines } from "@franki/core";
import type { StoredDoc } from "../store/port";
import { HERO_BASELINE_GROCERIES, HERO_COVERAGE, HERO_MEETINGS, HERO_ORDERS, HERO_ZONE, bankRow, instantAt, sampleEvidence, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ensureCoreDocs } from "../core-docs";
import { paths } from "../store/paths";
import { callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { recordPendingRendered } from "../time/reminder";
import { toolRoute } from "./tool";
import { FILTER_EVERY_SUBJECT, heroOffer } from "./tool-food";
import { turnRoute } from "./turn";

const UID = "owner-1";
const SUGGEST = { domain: "food", query: "quick dinner", attendeeIds: [], when: null, contextId: null };
type Rig = ReturnType<typeof testRig>;
type Row = { id: string; rootKey: string; bank?: unknown; calendar?: unknown };
type Rule = CoreRules["allergies"][number];

const rule = (code: string, subjectId: string | null = "self", state: "active" | "pending" = "active"): Rule => ({
  id: testId(`rv-${code}-${subjectId ?? "anon"}`),
  subjectId,
  code,
  state,
  anonymous: subjectId === null,
  proof: null,
  proofRev: null,
  rootKeys: [],
  dependsOn: [],
});

async function insertRows(rig: Rig, rows: readonly Row[]) {
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

async function writeRules(rig: Rig, change: (r: CoreRules) => CoreRules) {
  await rig.store.transaction(UID, async (tx) => {
    const doc = (await tx.get<CoreRules>(paths.core(UID, "rules")))!;
    tx.update(paths.core(UID, "rules"), change(doc.data));
  });
}

const withRules = (rules: Rule[], bump = true) => (r: CoreRules): CoreRules => ({ ...r, allergies: [...r.allergies, ...rules], rulesRev: bump ? r.rulesRev + 1 : r.rulesRev });
const withProposal = (rules: Rule[]) => (r: CoreRules): CoreRules => ({ ...r, proposals: [...(r.proposals ?? []), { id: testId(`prop${rules.length}`), origin: "backstop", turnId: null, eid: testId("prop-eid"), install: rules }] });

/**
 * The hero fixture, one session, and the turns given (each a user turn, in order). `present` says after which turn
 * (0 = before the first) the offer is recorded as shown, or null for never.
 */
async function setup(opts: { turns: string[]; rules?: Rule[]; proposals?: Rule[]; present?: number | null; rows?: Row[] }) {
  const rig = testRig();
  rig.clock.setWorld(instantAt("2026-10-26", 12 * 60, HERO_ZONE));
  await ensureCoreDocs(UID, rig.deps);
  await rig.store.transaction(UID, async (tx) => {
    const state = await tx.get<CoreState>(paths.core(UID, "state"));
    tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE, coverage: HERO_COVERAGE });
  });
  if (opts.rules !== undefined) await writeRules(rig, withRules(opts.rules));
  await insertRows(rig, opts.rows ?? [...HERO_ORDERS, ...HERO_BASELINE_GROCERIES, ...HERO_MEETINGS]);
  const s = await openTestSession(rig);
  await rig.store.transaction(UID, async (tx) => {
    const state = await tx.get<CoreState>(paths.core(UID, "state"));
    tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE });
  });
  const ctx = { uid: UID, deps: rig.deps, schedule: rig.sched.schedule };
  const present = opts.present === undefined ? opts.turns.length - 1 : opts.present;
  const offer = await heroOffer(ctx, s.stamp.generation);
  const show = async () => {
    rig.clock.advance(10);
    await rig.store.transaction(UID, (tx) => recordPendingRendered(tx, UID, offer!.pendingId as never, rig.deps.clock.read().opsClock.now, rig.deps.hasher));
    rig.clock.advance(10);
  };
  for (const [i, text] of opts.turns.entries()) {
    if (present === i && offer !== null) await show();
    const res = await callRoute(rig, turnRoute, asrTurn(s.stamp, i + 1, text, [{ itemId: `item_${i + 1}`, commitSeq: i + 1 }]));
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  }
  // A proposal lands after the turns: the next turn or open would install it (G39), and the food paths must read it
  // before then.
  if (opts.proposals !== undefined) await writeRules(rig, withProposal(opts.proposals));
  const stamp = { ...s.stamp, turnId: testId(`turn-${opts.turns.length}`) };
  let n = 0;
  const tool = (t: Record<string, unknown>) => callRoute(rig, toolRoute, { requestId: testId(`tool${++n}`), stamp, callId: "call_1", tool: t });
  const actions = async () => (await rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).filter((d) => d.data.kind === "action");
  const listOf = (a: StoredDoc<Ledger>) => (a.data.payload as { items: { label: string }[] }).items.map((i) => i.label);
  return { rig, ctx, stamp, offer, tool, actions, listOf };
}

const yes = (o: { pendingId: string; yesId: string } | null) => ({ name: "answer", args: { pendingId: o?.pendingId ?? "none", choiceId: o?.yesId ?? "none" } });

describe("finding 11: the food paths read rule proposals", () => {
  it("a backstop proposal's egg rule filters suggest", async () => {
    const t = await setup({ turns: ["What should I make for dinner"], proposals: [rule("egg", "self", "pending")] });
    const res = await t.tool({ name: "suggest", args: SUGGEST });
    for (const l of res.body.result.cards[0].lines as string[]) expect(l).not.toMatch(/eggs/);
  });
});
