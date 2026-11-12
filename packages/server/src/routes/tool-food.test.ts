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
  sampleBlock,
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
import { memoryTick } from "../time/tick";
import { recordPendingRendered } from "../time/reminder";

const UID = "owner-1";
const SUGGEST = { domain: "food", query: "quick dinner", attendeeIds: [], when: null, contextId: null };

type Row = { id: string; rootKey: string; bank?: unknown; calendar?: unknown };

async function insertRows(rig: ReturnType<typeof testRig>, rows: readonly Row[], typedOnly = false) {
  await rig.store.transaction(UID, async (tx) => {
    for (const r of rows) {
      const kind = r.bank !== undefined ? "transaction" : "calendar";
      const text = `${kind} ${r.id}`;
      const slice = typedOnly
        ? { eid: r.id, fieldPath: kind === "transaction" ? ("bank.amount" as const) : ("calendar.time" as const), start: null, end: null, contentHash: rig.deps.hasher.sha256(new TextEncoder().encode(r.id)), class: "O" as const, sens: "S1" as const }
        : buildSlice({ eid: r.id, fieldPath: "text", fieldText: text, start: 0, end: text.length, class: "O", sens: "S1" }, rig.deps.hasher);
      tx.create(
        paths.evidence(UID, r.id),
        sampleEvidence({ logicalId: r.id, kind, source: kind === "transaction" ? "plaid" : "calendar", observation: (r.bank ?? r.calendar) as never, rootKeys: [r.rootKey], text: { kind: "inline", text }, fieldSlices: [slice] }),
      );
    }
  });
}

async function setup(opts: { turnText: string; shellfish?: boolean; rows?: boolean; typedOnly?: boolean } = { turnText: "What should I make for dinner" }) {
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
  if (opts.rows !== false) await insertRows(rig, [...HERO_ORDERS, ...HERO_BASELINE_GROCERIES, ...HERO_MEETINGS], opts.typedOnly === true);
  const s = await openTestSession(rig);
  // The open sets the zone from the client; the fixture lives in Chicago.
  await rig.store.transaction(UID, async (tx) => {
    const state = await tx.get<CoreState>(paths.core(UID, "state"));
    tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE });
  });
  // Brief 037, finding 4: a yes acts only on an offer shown just before it, so the offer (if any) is shown first.
  const ctx0 = { uid: UID, deps: rig.deps, schedule: rig.sched.schedule };
  const shown = await heroOffer(ctx0, s.stamp.generation);
  if (shown !== null) await rig.store.transaction(UID, (tx) => recordPendingRendered(tx, UID, shown.pendingId as never, rig.deps.clock.read().opsClock.now, rig.deps.hasher));
  rig.clock.advance(10);
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

  it("a blocked row is not counted: the offer reads the owner's blocks (brief 028 finding 3, brief 030 P1-9)", async () => {
    const { rig, ctx, stamp } = await setup();
    const before = (await heroOffer(ctx, stamp.generation))!;
    expect(before.pattern.totalCents).toBe(18600);
    const order = HERO_ORDERS[0]!;
    await rig.store.transaction(UID, async (tx) => {
      tx.create(paths.block(UID, testId("block-1")), sampleBlock({ uid: UID, kind: "root", rootKey: order.rootKey, key: order.rootKey, createdFrom: { type: "evidence", id: order.id, rev: 1 } }));
    });
    const after = await heroOffer(ctx, stamp.generation);
    expect(after?.pattern.totalCents ?? 0).toBeLessThan(18600);
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

  it("the loop's root Slices are the rows' text Slices, and a row with only typed Slices makes the yes stale (brief 030 P1-2)", async () => {
    const typed = await setup({ turnText: "Yes, let's do it", typedOnly: true });
    const offer = (await heroOffer(typed.ctx, typed.stamp.generation))!;
    const res = await typed.tool({ name: "answer", args: { pendingId: offer.pendingId, choiceId: offer.yesId } });
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ state: "stale", receiptId: null });
    expect(await typed.rig.store.get(UID, paths.ledger(UID, typed.rig.deps.hasher.id(["heroAction", offer.pendingId])))).toBeNull();

    const text = await setup({ turnText: "Yes, let's do it" });
    const o2 = (await heroOffer(text.ctx, text.stamp.generation))!;
    const yes = await text.tool({ name: "answer", args: { pendingId: o2.pendingId, choiceId: o2.yesId } });
    const loopId = text.rig.deps.hasher.id(["heroLoop", o2.pendingId]);
    expect(yes.body.result.state).toBe("applied");
    const loop = (await text.rig.store.get<Memory>(UID, paths.memory(UID, loopId)))!.data;
    expect(loop.rootSlices.every((x) => x.start !== null && x.end !== null)).toBe(true);
  });

  it("at checkAt the tick stores the comparison: the loop is eligible and its celebrate moment carries the numbers (brief 030 P1-3)", async () => {
    const { rig, ctx, stamp, tool } = await setup({ turnText: "Yes, let's do it" });
    const offer = (await heroOffer(ctx, stamp.generation))!;
    const yes = await tool({ name: "answer", args: { pendingId: offer.pendingId, choiceId: offer.yesId } });
    expect(yes.body.result.state).toBe("applied");
    const loopId = rig.deps.hasher.id(["heroLoop", offer.pendingId]);
    await insertRows(rig, [...HERO_AFTER_ORDERS, ...HERO_AFTER_GROCERIES]);
    const loopOf = async () => (await rig.store.get<Memory>(UID, paths.memory(UID, loopId)))!.data.loop!;

    await memoryTick(ctx);
    expect((await loopOf()).state).toBe("waiting");

    rig.clock.setWorld(instantAt("2026-11-17", 9 * 60, HERO_ZONE));
    await memoryTick(ctx);
    expect((await loopOf()).state).toBe("eligible");
    const moments = await rig.store.query<{ kind: string; status: string; payload: Record<string, unknown> }>(UID, { collection: paths.collection(UID, "moments"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
    const celebrate = moments.find((m) => m.data.kind === "celebrate");
    expect(celebrate?.data).toMatchObject({ status: "leased", payload: { kind: "celebrate", loopId, before: 18600, after: 7100, delta: 11500 } });
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
