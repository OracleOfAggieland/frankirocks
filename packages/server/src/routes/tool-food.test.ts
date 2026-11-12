import { type CoreRules, type CoreState, type Ledger, type Memory, ToolResponse, buildSlice, validate } from "@franki/core";
import {
  HERO_AFTER_GROCERIES,
  HERO_AFTER_ORDERS,
  HERO_BASELINE_GROCERIES,
  HERO_COVERAGE,
  HERO_MEETINGS,
  HERO_ORDERS,
  HERO_ZONE,
  instantAt,
  sampleEvidence,
  testId,
} from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ensureCoreDocs } from "../core-docs";
import { paths } from "../store/paths";
import { callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { toolRoute } from "./tool";
import { answerTool, compareLoop, heroOffer } from "./tool-food";
import { turnRoute } from "./turn";

const UID = "owner-1";
const SUGGEST = { domain: "food", query: "quick dinner", attendeeIds: [], when: null, contextId: null };

type Row = { id: string; rootKey: string; bank?: unknown; calendar?: unknown };

async function insertRows(rig: ReturnType<typeof testRig>, rows: readonly Row[]) {
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

async function setup(opts: { turnText: string; shellfish?: boolean; rows?: boolean } = { turnText: "What should I make for dinner" }) {
  const rig = testRig();
  rig.clock.setWorld(instantAt("2026-10-26", 12 * 60, HERO_ZONE));
  await ensureCoreDocs(UID, rig.deps);
  await rig.store.transaction(UID, async (tx) => {
    const state = await tx.get<CoreState>(paths.core(UID, "state"));
    tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE, coverage: HERO_COVERAGE });
    if (opts.shellfish === true) {
      const rules = await tx.get<CoreRules>(paths.core(UID, "rules"));
      const rule = { id: testId("rule-shellfish"), subjectId: "self", code: "shellfish", state: "active", anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
      tx.update(paths.core(UID, "rules"), { ...rules!.data, allergies: [rule] });
    }
  });
  if (opts.rows !== false) await insertRows(rig, [...HERO_ORDERS, ...HERO_BASELINE_GROCERIES, ...HERO_MEETINGS]);
  const s = await openTestSession(rig);
  // The open sets the zone from the client; the fixture lives in Chicago.
  await rig.store.transaction(UID, async (tx) => {
    const state = await tx.get<CoreState>(paths.core(UID, "state"));
    tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE });
  });
  const turnRes = await callRoute(rig, turnRoute, asrTurn(s.stamp, 1, opts.turnText, [{ itemId: "item_1", commitSeq: 1 }]));
  if (turnRes.status !== 200) throw new Error(JSON.stringify(turnRes.body));
  const stamp = { ...s.stamp, turnId: testId("turn-1") };
  let n = 0;
  const tool = (t: Record<string, unknown>) => callRoute(rig, toolRoute, { requestId: testId(`tool${++n}`), stamp, callId: "call_1", tool: t });
  const ctx = { uid: UID, deps: rig.deps, schedule: rig.sched.schedule };
  return { rig, stamp, tool, ctx };
}

describe("POST /api/tool (suggest, food)", () => {
  it("returns three quick dinners from the catalog, code-picked, with a food card and a Permit", async () => {
    const { tool } = await setup();
    const res = await tool({ name: "suggest", args: SUGGEST });
    expect(res.status).toBe(200);
    expect(validate(ToolResponse, res.body).ok).toBe(true);
    expect(res.body.status).toBe("ready");
    expect(res.body.permit).not.toBeNull();
    expect(res.body.result).toMatchObject({ name: "suggest", reason: "Ready in 10 minutes", question: null, coverage: { state: "complete" } });
    expect(res.body.result.candidateIds).toHaveLength(3);
    expect(res.body.result.selectedId).toBe(res.body.result.candidateIds[0]);
    expect(res.body.result.cards[0].lines.map((l: string) => l.split(",")[0])).toEqual(["Spinach and mushroom omelet with toast", "Black bean tacos", "Chicken quesadillas"]);
  });

  it("with the owner's shellfish rule, nothing returned holds shellfish", async () => {
    const { tool } = await setup({ turnText: "What should I make for dinner", shellfish: true });
    const res = await tool({ name: "suggest", args: SUGGEST });
    expect(res.body.result.candidateIds).toHaveLength(3);
    for (const line of res.body.result.cards[0].lines as string[]) expect(line).not.toMatch(/shrimp|seafood/);
  });

  it("another domain returns no candidates and unknown coverage", async () => {
    const { tool } = await setup();
    const res = await tool({ name: "suggest", args: { ...SUGGEST, domain: "time" } });
    expect(res.body.result).toMatchObject({ candidateIds: [], selectedId: null, coverage: { state: "unknown" } });
  });
});

describe("the hero offer and its yes", () => {
  it("the offer is worded by code from the owner's rows", async () => {
    const { ctx, stamp } = await setup();
    const offer = await heroOffer(ctx, stamp.generation);
    expect(offer?.line).toBe("You've spent $186 on takeout in this window, mostly on nights with meetings after 6. Sources are on the card. Want three quick dinners for those nights, with groceries on your list?");
    expect(offer?.pattern).toMatchObject({ totalCents: 18600, lateCents: 12600, orderCount: 6, lateOrderCount: 4 });
    expect(offer?.card.sources).toHaveLength(10);
  });

  it("no rows, no offer", async () => {
    const { ctx, stamp } = await setup({ turnText: "Hi", rows: false });
    expect(await heroOffer(ctx, stamp.generation)).toBeNull();
  });

  it("'yes' writes the grocery list and the loop once, then the comparison three weeks on says $71, down from $186", async () => {
    const { rig, ctx, stamp, tool } = await setup({ turnText: "Yes, let's do it" });
    const offer = (await heroOffer(ctx, stamp.generation))!;
    const res = await tool({ name: "answer", args: { pendingId: offer.pendingId, choiceId: offer.yesId } });
    expect(validate(ToolResponse, res.body).ok).toBe(true);
    expect(res.body.result).toMatchObject({ name: "answer", state: "applied", pendingId: offer.pendingId });
    const actionId = res.body.result.receiptId as string;
    const action = await rig.store.get<Ledger>(UID, paths.ledger(UID, actionId));
    expect(action?.data).toMatchObject({ kind: "action", state: "complete", payload: { executor: "makeList", pendingId: offer.pendingId } });
    const payload = action!.data.payload as { items: { label: string }[]; loopId: string };
    expect(payload.items.map((i) => i.label)).toContain("black beans");
    const loopDoc = await rig.store.get<Memory>(UID, paths.memory(UID, payload.loopId));
    expect(loopDoc?.data.loop).toMatchObject({ metric: "takeoutSpend", state: "waiting", baseline: { valueCents: 18600 }, comparison: { fromCivil: "2026-10-27", toCivil: "2026-11-16" } });
    expect(loopDoc!.data.dependsOn.length).toBeGreaterThan(0);

    // A second yes on the same offer writes nothing new and gives the same receipt. (Through the route, a second
    // request with identical output on the same stamp collides on the seam's decision ID: contract question H-163.)
    const turn = (await rig.store.get(UID, paths.turn(UID, stamp.sessionId, stamp.turnId)))!.data as never;
    const again = await answerTool(ctx, stamp, { pendingId: offer.pendingId, choiceId: offer.yesId }, turn);
    expect(again).toMatchObject({ state: "applied", receiptId: actionId });
    const loops = (await rig.store.query<Memory>(UID, { collection: paths.collection(UID, "memories"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).filter((d) => d.data.kind === "loop");
    expect(loops).toHaveLength(1);

    // Before checkAt the comparison waits and says nothing.
    await insertRows(rig, [...HERO_AFTER_ORDERS, ...HERO_AFTER_GROCERIES]);
    const early = await compareLoop(ctx, payload.loopId, stamp.generation);
    expect(early).toMatchObject({ takeout: { status: "waiting" }, lines: null });

    rig.clock.setWorld(instantAt("2026-11-17", 9 * 60, HERO_ZONE));
    const later = await compareLoop(ctx, payload.loopId, stamp.generation);
    expect(later?.takeout).toMatchObject({ status: "eligible", beforeCents: 18600, afterCents: 7100, deltaCents: 11500 });
    expect(later?.lines).toEqual(["Takeout's $71, down from $186 over the same three weeks.", "$115 less on takeout.", "All food spending was $231, down from $306 over the same three weeks."]);
  });

  it("words that aren't a plain yes write nothing", async () => {
    const { rig, ctx, stamp, tool } = await setup({ turnText: "Yes, but not tonight" });
    const offer = (await heroOffer(ctx, stamp.generation))!;
    const res = await tool({ name: "answer", args: { pendingId: offer.pendingId, choiceId: offer.yesId } });
    expect(res.body.result).toMatchObject({ state: "clarify", receiptId: null });
    expect(await rig.store.get(UID, paths.ledger(UID, rig.deps.hasher.id(["heroAction", offer.pendingId])))).toBeNull();
  });

  it("'no' declines and writes nothing; an unknown offer is stale", async () => {
    const { rig, ctx, stamp, tool } = await setup({ turnText: "No thanks" });
    const offer = (await heroOffer(ctx, stamp.generation))!;
    expect((await tool({ name: "answer", args: { pendingId: offer.pendingId, choiceId: offer.noId } })).body.result.state).toBe("declined");
    expect((await tool({ name: "answer", args: { pendingId: testId("other"), choiceId: offer.yesId } })).body.result.state).toBe("stale");
    expect(await rig.store.get(UID, paths.ledger(UID, rig.deps.hasher.id(["heroAction", offer.pendingId])))).toBeNull();
  });
});
