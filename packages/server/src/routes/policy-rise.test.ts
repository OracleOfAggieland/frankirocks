/**
 * A policyRev rise and stored Memories (R25.3 as read by design CQ 162; KV05; brief 014, S6). A late control hit,
 * on a Superseding_Post or a Parse_Repair, raises policyRev so the next Deck cancels older speech. It must not hide
 * what was stored before it: recall in the same call still reads the Memory, and the Head at the next open still
 * holds it. A raised epoch (the forget fence, contracts §8) still hides it. Memory_Store and Fake_OpenAI only.
 */
import type { CoreEpoch, SS } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { never, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { extractOutput, factItem } from "../testing/extract-fixtures";
import { callRoute, patchRecord, runScheduled, settle, testRig } from "../testing/fakes";
import { asrTurn, typedTurn } from "../testing/session-fixtures";
import { turnEvidenceId } from "../turns";
import { closeRoute } from "./close";
import { openRoute } from "./open";
import { toolRoute } from "./tool";
import { turnRoute } from "./turn";

const UID = "owner-1";
const LINE = "My dog is called Pip";
const FACT = "The owner's dog is called Pip";
const ARGS = { purpose: "answer", query: "dog name", entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" };
type Rig = ReturnType<typeof testRig>;
type Rise = "none" | "supersede" | "repair";

const items = (n: number) => [{ itemId: `item_${n}`, commitSeq: n }];
const post = (rig: Rig, body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);
const epochDoc = async (rig: Rig) => (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
const readerCalls = (rig: Rig) => rig.openai.requestsTo("responses.create").filter((r) => (r.body as { model?: string }).model === "test-bg-model").length;

/** Extraction answers with no items unless scripted; the recall reader answers with an empty supported read. */
function rig(): Rig {
  const r = testRig();
  r.openai.respond("responses.create", (body) =>
    (body as { model?: string }).model === "test-brain-model"
      ? ok(completed(JSON.stringify(extractOutput([]))))
      : ok(completed(JSON.stringify({ kind: "supported", statements: [], alternatives: [] }))),
  );
  return r;
}

async function open(r: Rig, label: string, previous: string | null) {
  const res = await callRoute(r, openRoute, { requestId: testId(label), initiator: "user", previousSessionId: previous, clientZone: "UTC", visitId: null });
  expect(res.status).toBe(200);
  const deck = res.body.deck;
  const stamp: SS = { sessionId: res.body.sessionId, epoch: deck.epoch, policyRev: deck.policyRev, bundleRev: deck.bundleRev, rulesRev: deck.rulesRev, generation: 1 };
  return { sessionId: res.body.sessionId as string, head: deck.head as { text: string; selectedRefs: unknown[] }, stamp };
}

const close = (r: Rig, label: string, sessionId: string) => callRoute(r, closeRoute, { requestId: testId(label), sessionId, generation: 1, reason: "user" });

/** Call 1: a typed "My dog is called Pip" whose extraction commits one Memory; the call then closes. */
async function storePip(r: Rig) {
  const s = await open(r, "open1", null);
  r.openai.script("responses.create", ok(completed("Pip, got it.")));
  await callRoute(r, turnRoute, typedTurn(s.stamp, 1, LINE, "s1-1"));
  const eid = turnEvidenceId(testId("turn-s1-1"), r.deps.hasher);
  r.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([factItem("statement", "new", FACT, [{ eid, fieldPath: "text", start: 0, end: LINE.length, quote: LINE }])])))));
  await runScheduled(r);
  await close(r, "close1", s.sessionId);
  return s.sessionId;
}

/** Turn 1 of the call is heard late and reads as forget, by the path named; returns the stamp after the rise. */
async function lateForget(r: Rig, stamp: SS, rise: Rise): Promise<SS> {
  if (rise === "supersede") {
    await post(r, asrTurn(stamp, 1, "", items(1), "missing", "s2-1"));
    r.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
    const late = await post(r, { ...asrTurn(stamp, 1, "forget what I said about work", items(1), "final", "s2-1"), requestId: testId("req-s2-1-late"), supersedesRequestId: testId("req-s2-1") });
    await runScheduled(r);
    return { ...stamp, policyRev: late.body.stamp.policyRev };
  }
  if (rise === "repair") {
    r.openai.script("decisions.create", never(), ok(decisionAnswer({ forget: 0.95 })));
    await post(r, asrTurn(stamp, 1, "forget what I said about work", items(1), "final", "s2-1"));
    await runScheduled(r);
    return { ...stamp, policyRev: (await epochDoc(r)).policyRev };
  }
  return stamp;
}

/** Asks "What is my dog called" on turn `seq` and calls the recall tool for it. */
async function recall(r: Rig, stamp: SS, seq: number) {
  await post(r, asrTurn(stamp, seq, "What is my dog called", items(seq), "final", `s2-${seq}`));
  await runScheduled(r);
  const before = readerCalls(r);
  const res = await callRoute(r, toolRoute, { requestId: testId(`tool-${seq}`), stamp: { ...stamp, turnId: testId(`turn-s2-${seq}`) }, callId: "call_1", tool: { name: "recall", args: ARGS } });
  return { status: res.body.status, coverage: res.body.result?.coverage?.state, readerCalls: readerCalls(r) - before };
}

/** Calls 1 to 3: store Pip, a call with the rise and a recall, then the next open. */
async function run(rise: Rise) {
  const r = rig();
  const first = await storePip(r);
  const s2 = await open(r, "open2", first);
  const before = (await epochDoc(r)).policyRev;
  const stamp = await lateForget(r, s2.stamp, rise);
  const raised = (await epochDoc(r)).policyRev - before;
  const recalled = await recall(r, stamp, rise === "none" ? 1 : 2);
  await close(r, "close2", s2.sessionId);
  const s3 = await open(r, "open3", s2.sessionId);
  return { raised, recalled, call2Head: s2.head, call3Head: s3.head };
}

describe("a policyRev rise and stored Memories", () => {
  it("control: with no rise, recall reads the stored Memory and the next Head holds it", async () => {
    const out = await run("none");
    expect(out.raised).toBe(0);
    expect(out.call2Head.text).toContain(FACT);
    expect(out.recalled.readerCalls).toBe(1);
    expect(out.call3Head.text).toContain(FACT);
    expect(out.call3Head.selectedRefs).toHaveLength(1);
  });

  for (const rise of ["supersede", "repair"] as const) {
    const how = rise === "supersede" ? "a Superseding_Post" : "a Parse_Repair";
    it.fails(`a late forget on ${how} raises policyRev and hides no stored Memory: recall reads it and the next Head holds it`, async () => {
      const out = await run(rise);
      expect(out.raised).toBe(1);
      expect(out.call2Head.text).toContain(FACT);
      expect(out.recalled.readerCalls).toBe(1);
      expect(out.call3Head.text).toContain(FACT);
      expect(out.call3Head.selectedRefs).toHaveLength(1);
    });
  }

  it("a raised epoch (the forget fence) still hides a Memory stored before it", async () => {
    const r = rig();
    const first = await storePip(r);
    const e = await epochDoc(r);
    await patchRecord<CoreEpoch>(r.store, UID, paths.core(UID, "epoch"), { epoch: e.epoch + 1, policyRev: e.policyRev + 1 });
    const s2 = await open(r, "open2", first);
    expect(s2.stamp.epoch).toBe(e.epoch + 1);
    expect(s2.head.text).not.toContain(FACT);
    expect(s2.head.selectedRefs).toHaveLength(0);
  });
});
