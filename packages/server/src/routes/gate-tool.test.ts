// Brief 030 part A: the Gate in front of a recall's notes on /api/tool.
import type { Ledger } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { fail, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { commitUserTurnForTest, insertMemoryForTest } from "../testing/extract-fixtures";
import { callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { toolRoute } from "./tool";
import { turnRoute } from "./turn";

const UID = "owner-1";
const isRecall = (body: unknown) => (body as { model?: string }).model === "test-bg-model";

async function recallOn(ownerWords: string, query: string) {
  const rig = testRig();
  const t = await commitUserTurnForTest(rig.store, UID, testId("src0"), "My sister works at the bank", rig.clock, rig.deps.hasher);
  const memId = await insertMemoryForTest(rig.store, UID, t, rig.deps.hasher, { sens: "S1" }, "m0");
  rig.openai.respond("responses.create", (body) =>
    isRecall(body) ? ok(completed(JSON.stringify({ kind: "supported", statements: [{ text: "Your sister works at the bank.", citations: [{ type: "memory", id: memId, rev: 1 }], memoryIds: [] }], alternatives: [] }))) : fail(new Error("no extraction")),
  );
  const s = await openTestSession(rig);
  await callRoute(rig, turnRoute, { ...asrTurn(s.stamp, 1, ownerWords, [{ itemId: "item_1", commitSeq: 1 }]), judge: "O" });
  const stamp = { ...s.stamp, turnId: testId("turn-1") };
  const args = { purpose: "answer", query, entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" };
  const res = await callRoute(rig, toolRoute, { requestId: testId("tool1"), stamp, callId: "call_1", tool: { name: "recall", args } });
  const rows = (await rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [{ field: "kind", op: "==", value: "gate" }], orderBy: { field: "at", dir: "desc" }, limit: 100 })).map((d) => d.data);
  return { res, rows, memId };
}

describe("the Gate on a recall's notes (brief 030 part A)", () => {
  it("the owner asked about the sister: the S1 note goes out", async () => {
    const { res } = await recallOn("Where does my sister work", "sister work");
    expect(res.body.status).toBe("ready");
    expect(res.body.result.notes.map((n: { text: string }) => n.text)).toEqual(["Your sister works at the bank."]);
  });

  it("the model's query names the sister but the owner never did: the note is held back, with its Gate row", async () => {
    const { res, rows, memId } = await recallOn("Where did I put the keys", "keys sister");
    expect(res.body.status).toBe("ready");
    expect(res.body.result.notes).toEqual([]);
    const gateRows = rows.filter((r) => r.kind === "gate");
    expect(gateRows).toHaveLength(1);
    expect(gateRows[0]).toMatchObject({ payload: { candidateId: memId, turnId: testId("turn-1"), verdict: "silent" } });
  });
});
