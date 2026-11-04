/**
 * Memory end to end on the server (R22.12, R14.5, R26.10): a typed user Turn commits, the Extractor runs with
 * Fake_OpenAI returning a valid `statement` Item, the Session closes, a new Session opens, and the Head compiled
 * at that open includes the Memory. Fake_OpenAI only; no network.
 */
import { type Memory, idParts } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { extractOutput, factItem } from "../testing/extract-fixtures";
import { callRoute, runScheduled, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { turnEvidenceId } from "../turns";
import { extractJobId } from "../worker/extract-jobs";
import { closeRoute } from "./close";
import { openRoute } from "./open";
import { turnRoute } from "./turn";

const UID = "owner-1";
const LINE = "My dog is called Pip";

function scriptExtraction(rig: ReturnType<typeof testRig>) {
  const eid = turnEvidenceId(testId("turn-1"), rig.deps.hasher);
  const item = factItem("statement", "new", "The owner's dog is called Pip", [{ eid, fieldPath: "text", start: 0, end: LINE.length, quote: LINE }]);
  rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([item])))));
  return { eid, jobId: extractJobId(eid, rig.deps.hasher) };
}

async function nextHead(rig: ReturnType<typeof testRig>, sessionId: string) {
  expect((await callRoute(rig, closeRoute, { requestId: testId("close1"), sessionId, generation: 1, reason: "user" })).body).toEqual({ state: "closed" });
  const open = await callRoute(rig, openRoute, { requestId: testId("open2"), initiator: "user", previousSessionId: sessionId, clientZone: "UTC", visitId: null });
  expect(open.status).toBe(200);
  return open.body.deck.head as { text: string; selectedRefs: { type: string; id: string }[] };
}

describe("memory end to end", () => {
  it("commit, extract, close, open: Memory is in the Head", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    rig.openai.script("responses.create", ok(completed("Pip, got it.")));
    const turn = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, LINE));
    expect(turn.body.status).toBe("ordinary");

    // The scheduled extraction (after() in the Web_App) runs after the response.
    const { jobId } = scriptExtraction(rig);
    await runScheduled(rig);
    const mid = rig.deps.hasher.id(idParts.memory(jobId, 0));
    const memory = (await rig.store.get<Memory>(UID, paths.memory(UID, mid)))!.data;
    expect(memory).toMatchObject({ status: "active", sourceClass: "U", value: { kind: "text", text: "The owner's dog is called Pip" } });

    const head = await nextHead(rig, s.sessionId);
    expect(head.text).toContain("The owner's dog is called Pip");
    expect(head.selectedRefs).toEqual([{ type: "memory", id: mid, rev: 1 }]);
  });

  it("session open drains the job itself when no background work ran (R22.12)", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    rig.openai.script("responses.create", ok(completed("Pip, got it.")));
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, LINE));
    const { jobId } = scriptExtraction(rig);
    // Nothing scheduled ever runs (CPU-throttled after(), say): close and open must still get the Memory in.
    const head = await nextHead(rig, s.sessionId);
    expect(head.text).toContain("The owner's dog is called Pip");
    expect(head.selectedRefs.map((r) => r.id)).toEqual([rig.deps.hasher.id(idParts.memory(jobId, 0))]);
  });
});
