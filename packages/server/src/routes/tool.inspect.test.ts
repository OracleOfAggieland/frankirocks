// The recall tool's `inspect` purpose: snapshot() and two recent told lines, no model call (brief 020).
import { ToolResponse, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { fail } from "../openai/fake";
import { commitUserTurnForTest, insertMemoryForTest } from "../testing/extract-fixtures";
import { callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { toolRoute } from "./tool";
import { turnRoute } from "./turn";

const UID = "owner-1";
const ARGS = { purpose: "inspect", query: "what do you know about me", entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" };

async function run(judge: "O" | "timeout") {
  const rig = testRig();
  rig.openai.respond("responses.create", () => fail(new Error("no model call expected")));
  const t = await commitUserTurnForTest(rig.store, UID, testId("src0"), "My dog is called Pip", rig.clock, rig.deps.hasher);
  const s0 = await insertMemoryForTest(rig.store, UID, t, rig.deps.hasher, { key: testId("k0") }, "m0");
  const s1 = await insertMemoryForTest(rig.store, UID, t, rig.deps.hasher, { key: testId("k1"), sens: "S1", value: { kind: "text", text: "My sister works at the bank" } }, "m1");
  const guess = await insertMemoryForTest(rig.store, UID, t, rig.deps.hasher, { key: testId("k2"), sourceClass: "M", value: { kind: "text", text: "You may be moving" } }, "m2");
  const s = await openTestSession(rig);
  await callRoute(rig, turnRoute, { ...asrTurn(s.stamp, 1, "What do you know about me", [{ itemId: "item_1", commitSeq: 1 }]), judge });
  const stamp = { ...s.stamp, turnId: testId("turn-1") };
  const res = await callRoute(rig, toolRoute, { requestId: testId("tool1"), stamp, callId: "call_1", tool: { name: "recall", args: ARGS } });
  return { rig, res, s0, s1, guess };
}

describe("POST /api/tool (recall, inspect)", () => {
  it("answers with snapshot() and its recent told lines, with no model call", async () => {
    const { rig, res, s0, s1, guess } = await run("O");
    expect(res.status).toBe(200);
    expect(validate(ToolResponse, res.body).ok).toBe(true);
    expect(res.body.status).toBe("ready");
    const ids = res.body.result.snapshot.cards.map((c: { id: string }) => c.id);
    expect(ids.sort()).toEqual([s0, s1].sort());
    expect(ids).not.toContain(guess);
    expect(res.body.result.snapshot.overview.guesses).toBe(1);
    expect(res.body.result.notes.length).toBeLessThanOrEqual(2);
    expect(res.body.result.notes.length).toBeGreaterThan(0);
    expect(rig.openai.requestsTo("responses.create").filter((r) => (r.body as { model?: string }).model === "test-bg-model")).toHaveLength(0);
  });

  it("an S0-only admission takes the S1 lines out of the snapshot too", async () => {
    const { res, s1 } = await run("timeout");
    expect(res.body.status).toBe("ready");
    expect(res.body.result.snapshot.cards.map((c: { id: string }) => c.id)).not.toContain(s1);
    expect(res.body.result.notes.every((n: { sens: string }) => n.sens === "S0")).toBe(true);
    expect(res.body.result.snapshot.overview.recentTold.every((n: { sens: string }) => n.sens === "S0")).toBe(true);
  });
});
