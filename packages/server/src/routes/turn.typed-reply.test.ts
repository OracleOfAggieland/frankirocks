import { type Job, type Session, TurnResponse, payloadHash, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { fail, never, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { commitUserTurnForTest, insertMemoryForTest } from "../testing/extract-fixtures";
import { callRoute, patchRecord, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { extractJobId } from "../worker/extract-jobs";
import { turnEvidenceId } from "../turns";
import { turnRoute } from "./turn";
import { TYPED_REPLY_DEADLINE_MS } from "./typed-reply";

const UID = "owner-1";

describe("typed reply without a call", () => {
  it("reply arrives as one W note", async () => {
    const rig = testRig();
    // A Memory in the Head, so the note carries its roots and sensitivity.
    await openTestSession(rig, "warmup");
    const prior = await commitUserTurnForTest(rig.store, UID, testId("t0"), "My dog is called Pip", rig.clock, rig.deps.hasher);
    const mid = await insertMemoryForTest(rig.store, UID, prior, rig.deps.hasher, { sens: "S1" });
    const s = await openTestSession(rig, "open2");
    rig.openai.script("responses.create", ok(completed("Pip is your dog.")));
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "What's my dog called?"));
    expect(res.status).toBe(200);
    expect(validate(TurnResponse, res.body).ok).toBe(true);
    expect(res.body.notes).toHaveLength(1);
    const note = res.body.notes[0];
    const memory = (await rig.store.get<{ rootKeys: string[]; dependsOn: string[] }>(UID, paths.memory(UID, mid)))!.data;
    expect(note).toMatchObject({ kind: "result", text: "Pip is your dog.", unprompted: false, momentId: null, sens: "S1", rootKeys: memory.rootKeys, dependsOn: memory.dependsOn });
    // The note is part of the admitted payload.
    expect(res.body.permit.noteIds).toEqual([note.noteId]);
    expect(res.body.permit.approvedPayloadHash).toBe(
      payloadHash({ stamp: res.body.stamp, head: res.body.deck.head, notes: [note], turns: res.body.deck.turns, audioIds: [], toolOutput: null }, rig.deps.hasher),
    );
  });

  it("Fake_OpenAI request uses FRANKI_BRAIN_MODEL", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    rig.openai.script("responses.create", ok(completed("Hello!")));
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hi there"));
    const [request] = rig.openai.requestsTo("responses.create");
    expect(request!.body).toMatchObject({
      model: "test-brain-model",
      reasoning: { effort: "low" },
      store: false,
      tools: [expect.objectContaining({ name: "make_phone_call", strict: true })],
      instructions: s.deck.head.text,
      input: [{ role: "user", content: "hi there" }],
    });
  });

  it("Extract_Job starts only after the response (scheduled)", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    rig.openai.script("responses.create", ok(completed("Noted.")));
    const pending = rig.sched.pending;
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "I like green tea"));
    expect(res.status).toBe(200);
    expect(rig.sched.pending).toBe(pending + 1);
    const eid = turnEvidenceId(testId("turn-1"), rig.deps.hasher);
    const job = (await rig.store.get<Job>(UID, paths.job(UID, extractJobId(eid, rig.deps.hasher))))!.data;
    // Written in the Turn's transaction, still queued: nothing ran it before the response.
    expect(job).toMatchObject({ status: "queued", attempts: 0, generation: 0 });
    // Only the typed reply reached OpenAI during the request.
    expect(rig.openai.requestsTo("responses.create")).toHaveLength(1);
    // The Session stays open (R18.4).
    expect((await rig.store.get<Session>(UID, paths.session(UID, s.sessionId)))!.data.status).toBe("minting");
  });

  it("makes no reply call while a call is open", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { callId: "rtc_1", registeredCallIds: ["rtc_1"], status: "active" });
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hi there"));
    expect(res.body.notes).toEqual([]);
    expect(rig.openai.requestsTo("responses.create")).toHaveLength(0);
  });

  it("a failed or timed-out reply call still commits the Turn, with no note, within the deadline", async () => {
    for (const result of [fail(new Error("openai down")), never()]) {
      const rig = testRig();
      const s = await openTestSession(rig);
      rig.openai.script("responses.create", result);
      const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hi there"));
      expect(res.body).toMatchObject({ status: "ordinary", notes: [] });
      expect(res.elapsedMs).toBeLessThanOrEqual(TYPED_REPLY_DEADLINE_MS);
      expect(await rig.store.get(UID, paths.turn(UID, s.sessionId, testId("turn-1")))).not.toBeNull();
    }
  });

  it("a replay makes no second OpenAI call", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    rig.openai.script("responses.create", ok(completed("Hello!")));
    const a = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hi there"));
    const b = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hi there"));
    expect(b.body).toEqual(a.body);
    expect(rig.openai.requestsTo("responses.create")).toHaveLength(1);
  });
});
