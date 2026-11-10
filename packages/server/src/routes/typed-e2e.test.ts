/**
 * Checkpoint: the typed memory path end to end (task 28; R22.12, R29.1, R26.4; brief demo goal for typed input).
 * A typed line commits through /api/turn, the scheduled extraction stores a Memory, GET /api/debug/memory shows the
 * Turn, its Evidence, the complete Extract_Job, the admission decision and the Memory with resolved lineage, and
 * the Head compiled at the next session open contains the Memory. Fake_OpenAI only; no network.
 */
import { type DebugItem, type DebugPage, DebugPage as DebugPageSchema, type Memory, idParts, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { extractOutput, factItem } from "../testing/extract-fixtures";
import { type TestRig, callRoute, runScheduled, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { turnEvidenceId } from "../turns";
import { extractJobId } from "../worker/extract-jobs";
import { closeRoute } from "./close";
import { debugMemoryRoute } from "./debug-memory";
import { openRoute } from "./open";
import { turnRoute } from "./turn";

const LINE = "My dog is called Pip";

async function debug(rig: TestRig, section: string, sessionId?: string): Promise<DebugPage> {
  const qs = new URLSearchParams({ section, ...(sessionId === undefined ? {} : { sessionId }) });
  const res = await callRoute(rig, debugMemoryRoute, undefined, { method: "GET", url: `http://localhost:3000/api/debug/memory?${qs}`, origin: null });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(validate(DebugPageSchema, res.body).ok).toBe(true);
  return res.body as DebugPage;
}

const of = <K extends DebugItem["kind"]>(page: DebugPage, kind: K) => page.items.filter((i): i is Extract<DebugItem, { kind: K }> => i.kind === kind);

describe("typed memory path end to end", () => {
  it("typed line → extract → debug route shows the Memory with lineage → next open's Head contains it", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);

    // 1. The typed line: the reply (no call open) and the TurnResponse come before any extraction (R18.4).
    rig.openai.script("responses.create", ok(completed("Pip, got it.")));
    const turn = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, LINE));
    expect(turn.status).toBe(200);
    expect(turn.body).toMatchObject({ status: "ordinary", permit: { kind: "slowOrdinary" }, notes: [{ text: "Pip, got it." }] });
    expect(rig.sched.pending).toBeGreaterThan(0);

    const eid = turnEvidenceId(testId("turn-1"), rig.deps.hasher);
    const jobId = extractJobId(eid, rig.deps.hasher);
    const before = await debug(rig, "jobs");
    expect(of(before, "job").map((j) => [j.id, j.record.status])).toEqual([[jobId, "queued"]]);
    expect(of(await debug(rig, "memories"), "memory")).toEqual([]);

    // 2. Scheduled extraction (after() in the Web_App), with Fake_OpenAI returning one statement Item.
    const quote = "Pip";
    const item = factItem("statement", "new", "The owner's dog is called Pip", [{ eid, fieldPath: "text", start: 17, end: 20, quote }]);
    rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([item])))));
    await runScheduled(rig);
    const mid = rig.deps.hasher.id(idParts.memory(jobId, 0));

    // 3. The debug route shows every record and where it came from.
    const turns = of(await debug(rig, "turns"), "turn");
    expect(turns.map((t) => [t.record.seq, t.record.role, t.record.evidenceId, t.record.text])).toEqual([[1, "user", eid, LINE]]);
    const evidence = of(await debug(rig, "evidence"), "evidence");
    expect(evidence.map((e) => [e.id, e.record.text, e.record.fieldSlices.map((f) => f.class)])).toEqual([[eid, { kind: "inline", text: LINE }, ["U"]]]);
    expect(of(await debug(rig, "jobs"), "job").map((j) => [j.id, j.record.status, j.record.error])).toEqual([[jobId, "complete", null]]);

    const memories = of(await debug(rig, "memories"), "memory");
    expect(memories.map((m) => m.id)).toEqual([mid]);
    const m = memories[0]!;
    expect(m.record as Memory).toMatchObject({ status: "active", sourceClass: "U", value: { kind: "text", text: "The owner's dog is called Pip" } });
    expect(m.lineage.ok).toBe(true);
    expect(m.lineage.failures).toEqual([]);
    expect(m.lineage.links.map((l) => [l.slice.eid, l.slice.start, l.slice.end, l.text])).toEqual([[eid, 17, 20, quote]]);

    const ledger = of(await debug(rig, "ledger"), "ledger");
    const admission = ledger.find((l) => l.issuer === "seam");
    expect(admission).toMatchObject({ permitKind: "slowOrdinary", record: { kind: "decision", payload: { purpose: "answer" } } });

    // 4. The Head of the open Session predates the Memory; the next open's Head contains it (R22.12, R26.4).
    const oldHead = of(await debug(rig, "head"), "head")[0]!.record.head!;
    expect(oldHead.text).not.toContain("The owner's dog is called Pip");
    expect((await callRoute(rig, closeRoute, { requestId: testId("close1"), sessionId: s.sessionId, generation: 1, reason: "user" })).body).toEqual({ state: "closed" });
    const open = await callRoute(rig, openRoute, { requestId: testId("open2"), initiator: "user", previousSessionId: s.sessionId, clientZone: "UTC", visitId: null });
    expect(open.status).toBe(200);
    expect(open.body.deck.head.text).toContain("The owner's dog is called Pip");
    expect(open.body.deck.head.selectedRefs).toEqual([{ type: "memory", id: mid, rev: 1 }]);

    const head = of(await debug(rig, "head"), "head")[0]!.record;
    expect(head.head!.text).toBe(open.body.deck.head.text);
    expect(head.head!.tokenCount).toBeLessThanOrEqual(3500);
    expect(head.selectedRefs).toEqual([{ type: "memory", id: mid, rev: 1 }]);

    // Only Fake_OpenAI was called: the typed reply and one extraction.
    expect(rig.openai.requestsTo("responses.create")).toHaveLength(2);
  });
});
