import { type Ledger, RECALL_DEADLINE_MS, TOOL_LIMIT_MS, ToolResponse, idParts, payloadHash, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { type ScriptedResult, fail, never, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { commitUserTurnForTest, insertMemoryForTest } from "../testing/extract-fixtures";
import { callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { TOOL_RESULT_LIMIT_MS, toolRoute } from "./tool";
import { turnRoute } from "./turn";

const UID = "owner-1";
const ARGS = { purpose: "answer", query: "dog name", entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" };

const isRecall = (body: unknown) => (body as { model?: string }).model === "test-bg-model";

async function setup(opts: { turnText?: string; memories?: number } = {}) {
  const rig = testRig();
  // Extraction requests (brain model) fail; recall requests (bg model) answer from the test's script.
  let recall: (body: any) => ScriptedResult = () => fail(new Error("unscripted recall"));
  rig.openai.respond("responses.create", (body) => (isRecall(body) ? recall(body) : fail(new Error("no extraction in this test"))));
  const memIds: string[] = [];
  const memTurns = [];
  for (let i = 0; i < (opts.memories ?? 1); i++) {
    const t = await commitUserTurnForTest(rig.store, UID, testId(`src${i}`), i === 0 ? "My dog is called Pip" : `Fact number ${i}`, rig.clock, rig.deps.hasher);
    memTurns.push(t);
    memIds.push(await insertMemoryForTest(rig.store, UID, t, rig.deps.hasher, {}, `m${i}`));
  }
  const s = await openTestSession(rig);
  const turnRes = await callRoute(rig, turnRoute, asrTurn(s.stamp, 1, opts.turnText ?? "What is my dog called", [{ itemId: "item_1", commitSeq: 1 }]));
  if (turnRes.status !== 200) throw new Error(JSON.stringify(turnRes.body));
  const stamp = { ...s.stamp, turnId: testId("turn-1") };
  let n = 0;
  const tool = (overrides: Record<string, unknown> = {}, args: Record<string, unknown> = {}) =>
    callRoute(rig, toolRoute, { requestId: testId(`tool${++n}`), stamp, callId: "call_1", tool: { name: "recall", args: { ...ARGS, ...args } }, ...overrides });
  const recallRequests = () => rig.openai.requestsTo("responses.create").filter((r) => isRecall(r.body));
  return { rig, s, stamp, tool, memIds, memTurns, setRecall: (fn: typeof recall) => (recall = fn), recallRequests };
}

const statement = (text: string, citations: unknown[]) => ({ text, citations, memoryIds: [] });
const output = (...statements: unknown[]) => ok(completed(JSON.stringify({ kind: "supported", statements, alternatives: [] })));

describe("POST /api/tool (recall)", () => {
  it("S1 recall notes need a judge-O turn in a private audience with no gap (voice-control R12.7, R8.11)", async () => {
    for (const [judge, kept] of [["O", true], ["timeout", false]] as const) {
      const rig = testRig();
      rig.openai.respond("responses.create", (body) => (isRecall(body) ? output(statement("Your sister works at the bank.", [{ type: "memory", id: memId, rev: 1 }])) : fail(new Error("no extraction"))));
      const t = await commitUserTurnForTest(rig.store, UID, testId("src0"), "My sister works at the bank", rig.clock, rig.deps.hasher);
      const memId = await insertMemoryForTest(rig.store, UID, t, rig.deps.hasher, { sens: "S1" }, "m0");
      const s = await openTestSession(rig);
      await callRoute(rig, turnRoute, { ...asrTurn(s.stamp, 1, "Where does my sister work", [{ itemId: "item_1", commitSeq: 1 }]), judge });
      const stamp = { ...s.stamp, turnId: testId("turn-1") };
      const res = await callRoute(rig, toolRoute, { requestId: testId("tool1"), stamp, callId: "call_1", tool: { name: "recall", args: { ...ARGS, query: "sister work" } } });
      expect(res.body.status).toBe("ready");
      expect(res.body.result.notes.some((n: { sens: string }) => n.sens !== "S0"), judge).toBe(kept);
    }
  });

  it("answers well before the browser stops waiting for it, with a second to spare for the network", () => {
    expect(TOOL_RESULT_LIMIT_MS + 1_000).toBeLessThanOrEqual(TOOL_LIMIT_MS);
  });

  it("ready: one RecallAllV1 read on FRANKI_BG_MODEL, cited notes, and a tool-continuation Permit over the tool output", async () => {
    const { rig, stamp, tool, memIds, memTurns, setRecall, recallRequests } = await setup();
    const ref = { type: "memory", id: memIds[0], rev: 1 };
    setRecall(() => output(statement("Your dog is called Pip.", [ref])));
    const res = await tool();
    expect(res.status).toBe(200);
    expect(validate(ToolResponse, res.body).ok).toBe(true);
    expect(res.elapsedMs).toBeLessThanOrEqual(TOOL_RESULT_LIMIT_MS);
    expect(res.body.status).toBe("ready");
    expect(res.body.result).toMatchObject({ name: "recall", coverage: { state: "complete" }, truncated: false, cursor: null, pendingId: null, snapshot: null });
    expect(res.body.result.notes).toEqual([
      expect.objectContaining({ kind: "result", text: "Your dog is called Pip.", unprompted: false, sens: "S0", dependsOn: [`e:${memTurns[0]!.eid}`] }),
    ]);
    expect(res.body.result.notes[0].rootKeys).toHaveLength(1);

    const [req] = recallRequests();
    expect(recallRequests()).toHaveLength(1);
    expect(req!.body).toMatchObject({ model: "test-bg-model", store: false, tools: [], max_output_tokens: 768, reasoning: { effort: "none" } });
    expect((req!.body as any).text.format).toMatchObject({ type: "json_schema", name: "RecallAllV1", strict: true });
    const input = JSON.parse((req!.body as any).input);
    expect(input).toMatchObject({ query: "dog name", purpose: "answer", coverage: { complete: true, truncated: false } });
    expect(input.packet).toEqual([
      { id: memIds[0], text: "fact: My dog is called Pip", roots: [expect.objectContaining({ eid: memTurns[0]!.eid, start: 0, end: 20, quote: "My dog is called Pip" })], refs: [ref], class: "U", sens: "S0" },
    ]);

    const { permit, deck, result } = res.body;
    expect(permit).toMatchObject({ kind: "slowOrdinary", scope: "reply", stamp, noteIds: [] });
    expect(permit.approvedPayloadHash).toBe(payloadHash({ stamp, head: deck.head, notes: [], turns: deck.turns, audioIds: ["item_1"], toolOutput: result }, rig.deps.hasher));
    const decision = (await rig.store.get<Ledger>(UID, paths.ledger(UID, permit.permitId)))!.data;
    expect(decision).toMatchObject({ kind: "decision", state: "complete", payload: { purpose: "answer", acceptedRefs: [{ type: "turn", id: stamp.turnId }, expect.objectContaining({ type: "ledger" })] } });
  });

  it("parse wait capped at 1.5 s → hold, with no read", async () => {
    const { stamp, tool, recallRequests } = await setup();
    const res = await tool({ stamp: { ...stamp, turnId: testId("not-yet") } });
    expect(res.body).toMatchObject({ status: "hold", result: null, permit: null });
    expect(res.elapsedMs).toBeGreaterThanOrEqual(1_500);
    expect(res.elapsedMs).toBeLessThan(1_700);
    expect(recallRequests()).toHaveLength(0);
  });

  it("stale stamp → stale with no result and no read", async () => {
    const { stamp, tool, recallRequests } = await setup();
    for (const patch of [{ bundleRev: stamp.bundleRev + 1 }, { generation: 2 }, { epoch: 9 }]) {
      const res = await tool({ stamp: { ...stamp, ...patch } });
      expect(res.body).toMatchObject({ status: "stale", result: null, permit: null });
    }
    expect(recallRequests()).toHaveLength(0);
  });

  it("stale when the stamp's Turn is not the Session's latest user Turn", async () => {
    const { rig, s, stamp, tool } = await setup();
    await callRoute(rig, turnRoute, asrTurn(s.stamp, 2, "And my cat", [{ itemId: "item_2", commitSeq: 2 }]));
    expect((await tool({ stamp })).body.status).toBe("stale");
  });

  it("uncited statements dropped: missing citations, unknown refs and unsupplied Spans", async () => {
    const { tool, memIds, memTurns, setRecall } = await setup();
    const ref = { type: "memory", id: memIds[0], rev: 1 };
    const span = { eid: memTurns[0]!.eid, fieldPath: "text", start: 0, end: 20, quote: "My dog is called Pip" };
    setRecall(() =>
      output(
        statement("Made up from outside.", [{ type: "memory", id: testId("ghost"), rev: 1 }]),
        statement("Half supported.", [ref, { type: "memory", id: testId("ghost"), rev: 1 }]),
        statement("Wrong quote.", [{ ...span, quote: "My cat is called Pip" }]),
        statement("Pip, from the span.", [span]),
      ),
    );
    const res = await tool();
    expect(res.body.result.notes.map((n: { text: string }) => n.text)).toEqual(["Pip, from the span."]);
  });

  it.each([
    ["an error", fail(new Error("openai 500"))],
    ["invalid JSON", ok(completed("{not json"))],
    ["a schema violation", ok(completed(JSON.stringify({ kind: "maybe", statements: [], alternatives: [] })))],
    ["a refusal", ok({ status: "completed", outputText: null, refusal: "no", usage: { inputTokens: 0, outputTokens: 0 } })],
    ["incomplete output", ok({ status: "incomplete", outputText: "{}", refusal: null, usage: { inputTokens: 0, outputTokens: 0 } })],
    ["no answer by the 2.5 s deadline", never()],
  ])("RecallAllV1 failure (%s) → ready with code-ranked excerpts of the stored lines and coverage partial", async (_label, result) => {
    const { tool, memTurns, setRecall } = await setup();
    setRecall(() => result);
    const res = await tool();
    expect(res.body).toMatchObject({ status: "ready", result: { coverage: { state: "partial" } } });
    expect(res.body.result.notes).toEqual([
      expect.objectContaining({ kind: "result", text: "fact: My dog is called Pip", unprompted: false, sens: "S0", dependsOn: [`e:${memTurns[0]!.eid}`] }),
    ]);
    expect(res.body.permit).not.toBeNull();
    expect(res.elapsedMs).toBeLessThanOrEqual(TOOL_RESULT_LIMIT_MS);
  });

  it("a failed read with no stored line on the topic → empty notes and coverage unknown", async () => {
    const { tool, setRecall } = await setup({ turnText: "What is my cat called" });
    setRecall(() => fail(new Error("openai 500")));
    const res = await tool({}, { query: "cat" });
    expect(res.body).toMatchObject({ status: "ready", result: { notes: [], coverage: { state: "unknown" } } });
  });

  it("the read gets at most RECALL_DEADLINE_MS, then excerpts answer within the route limit", async () => {
    const { tool, setRecall } = await setup();
    setRecall(() => never());
    const res = await tool();
    expect(res.elapsedMs).toBeGreaterThanOrEqual(RECALL_DEADLINE_MS);
    expect(res.elapsedMs).toBeLessThanOrEqual(TOOL_RESULT_LIMIT_MS);
    expect(res.body.result.notes).toHaveLength(1);
  });

  it("asked test: a Turn without any query term or alias gets empty notes and no read", async () => {
    const { tool, recallRequests } = await setup({ turnText: "Tell me something nice" });
    const res = await tool();
    expect(res.body).toMatchObject({ status: "ready", result: { notes: [] } });
    expect(recallRequests()).toHaveLength(0);
  });

  it("an entity alias counts as a term", async () => {
    const { tool, memIds, setRecall, recallRequests } = await setup({ turnText: "Tell me about Pip" });
    setRecall(() => output(statement("Pip is your dog.", [{ type: "memory", id: memIds[0], rev: 1 }])));
    const res = await tool({}, { query: "dog", entityRefs: [{ id: null, label: "Pip" }] });
    expect(res.body.result.notes).toHaveLength(1);
    expect(recallRequests()).toHaveLength(1);
  });

  it("invalid recall args are PARSE, with no read and no record", async () => {
    const { rig, tool, recallRequests } = await setup();
    const ledgerBefore = rig.store.countUnder(paths.collection(UID, "ledger"));
    expect((await tool({}, { query: "x".repeat(513) })).body.error).toBe("PARSE");
    expect((await tool({}, { extra: 1 })).body.error).toBe("PARSE");
    expect((await tool({}, { purpose: "delete" })).body.error).toBe("PARSE");
    expect((await tool({}, { entityRefs: Array.from({ length: 9 }, () => ({ id: null, label: "a" })) })).body.error).toBe("PARSE");
    expect(recallRequests()).toHaveLength(0);
    expect(rig.store.countUnder(paths.collection(UID, "ledger"))).toBe(ledgerBefore);
  });

  it("more eligible lines than fit: the packet stays within 8,000 tokens and the result is truncated/partial", async () => {
    const { tool, setRecall, recallRequests } = await setup({ memories: 205, turnText: "What fact number is it" });
    setRecall(() => output());
    const res = await tool({}, { query: "fact" });
    expect(res.body.result).toMatchObject({ truncated: true, coverage: { state: "partial" } });
    const body = recallRequests()[0]!.body as { input: string; instructions: string };
    const input = JSON.parse(body.input);
    expect(input.packet.length).toBeGreaterThan(50);
    expect(input.packet.length).toBeLessThan(200);
    expect(Math.ceil((body.input.length + body.instructions.length) / 4)).toBeLessThanOrEqual(8_000);
    expect(input.coverage).toEqual({ complete: false, truncated: true });
  });

  it("a replay returns the recorded response with no second read", async () => {
    const { rig, stamp, memIds, setRecall, recallRequests } = await setup();
    setRecall(() => output(statement("Pip.", [{ type: "memory", id: memIds[0], rev: 1 }])));
    const body = { requestId: testId("same"), stamp, callId: "call_1", tool: { name: "recall", args: ARGS } };
    const a = await callRoute(rig, toolRoute, body);
    const b = await callRoute(rig, toolRoute, body);
    expect(b.body).toEqual(a.body);
    expect(recallRequests()).toHaveLength(1);
    expect(rig.deps.hasher.id(idParts.permit(stamp, "slowOrdinary", a.body.permit.approvedPayloadHash))).toBe(a.body.permit.permitId);
  });
});
