// Brief 048 rulings 7 and 8: the acknowledgment on a typed answer, on the state route, and never twice.
import { FORGET_ACK_TEXTS, type Job, type Ledger, type Session, forgetAckText } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { openRoute } from "../routes/open";
import { stateRoute } from "../routes/state";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { forgetAckId } from "./ack";
import { forgetReceiptId } from "./fence";
import { fakeForgetResolve } from "./resolve-port";

const UID = "owner-1";
type Rig = ReturnType<typeof testRig>;

function rig(): Rig {
  const r = testRig();
  r.deps.forgetResolve = fakeForgetResolve(() => ({ resolution: "none", remove: [], candidateIds: [], entityIds: [], topicKeys: [], needsMore: false, clarification: null }));
  return r;
}
const post = (r: Rig, body: unknown) => settle(callRoute(r, turnRoute, body), r.clock, r.timers).then((x) => x.value);
const route = <B,>(r: Rig, spec: Parameters<typeof callRoute>[1], body: B) => settle(callRoute(r, spec, body), r.clock, r.timers).then((x) => x.value);
const forgetJob = async (r: Rig) => (await r.store.query<Job>(UID, { collection: paths.collection(UID, "jobs"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).find((j) => j.data.kind === "forget")!.data;
const isAck = (text: string | undefined) => text !== undefined && (FORGET_ACK_TEXTS as readonly string[]).includes(text);
const said = (job: Job) => {
  const p = job.payload;
  if (p.kind !== "forget" || p.ack === null) throw new Error("no ack on the job");
  return forgetAckText(p.ack.kind, "askAllergies" in p.ack ? p.ack.askAllergies : false);
};
const freshOpen = (r: Rig, label: string) => route(r, openRoute, { requestId: testId(label), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: null });

describe("the forget's acknowledgment (brief 048 rulings 7 and 8)", () => {
  it("a typed forget whose job reaches blockedAt in the route: the answer carries it, once, and the next open says nothing", async () => {
    const r = rig();
    const s = await openTestSession(r);
    r.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
    const res = await post(r, typedTurn(s.stamp, 1, "forget what I said about my brother"));
    const job = await forgetJob(r);
    const p = job.payload;
    if (p.kind !== "forget") throw new Error("not a forget");
    const receipt = (await r.store.get<Ledger>(UID, paths.ledger(UID, forgetReceiptId(p.opId, r.deps.hasher))))!.data;
    expect(receipt.kind === "forgetReceipt" && receipt.payload.blockedAt).not.toBeNull();
    expect(res.body.permit).toMatchObject({ kind: "postCommitControl", scope: "ack" });
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0]).toMatchObject({ kind: "ack", sens: "S0", text: said(job) });
    expect(res.body.permit.noteIds).toEqual([res.body.notes[0].noteId]);
    expect(await r.store.get(UID, paths.ledger(UID, forgetAckId(p.opId, r.deps.hasher)))).not.toBeNull();
    // The same request again answers the same, with the line.
    const again = await post(r, typedTurn(s.stamp, 1, "forget what I said about my brother"));
    expect(again.body.notes).toEqual(res.body.notes);
    const o = await freshOpen(r, "open-after");
    expect(o.body.state).toBe("connecting");
    expect(isAck(o.body.proactive?.whisper.text)).toBe(false);
  });

  it("a typed forget that the route leaves before blockedAt: no line in the answer; the state route says it once when it is ready", async () => {
    const r = rig();
    // Another device's call, whose hang-up has no answer yet, keeps the barrier up past the route's budget.
    const other = await openTestSession(r, "other");
    const typed = await openTestSession(r, "typed");
    await r.sched.runAll();
    await patchRecord<Session>(r.store, UID, paths.session(UID, other.sessionId), { status: "active", callId: "rtc_9", registeredCallIds: ["rtc_9"] });
    r.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
    const res = await post(r, typedTurn(typed.stamp, 1, "forget what I said about my brother"));
    expect(res.body.permit).toMatchObject({ kind: "postCommitControl", scope: "ack" });
    expect(res.body.notes).toEqual([]);
    const job = await forgetJob(r);
    const p = job.payload;
    if (p.kind !== "forget") throw new Error("not a forget");
    const blockedAt = async () => {
      const x = (await r.store.get<Ledger>(UID, paths.ledger(UID, forgetReceiptId(p.opId, r.deps.hasher))))!.data;
      return x.kind === "forgetReceipt" ? x.payload.blockedAt : null;
    };
    expect(await blockedAt()).toBeNull();

    const body = () => ({ sessionId: typed.sessionId, generation: 1, seen: { epoch: typed.deck.epoch, policyRev: typed.deck.policyRev, bundleRev: typed.deck.bundleRev, rulesRev: typed.deck.rulesRev }, ackStamp: null, speechStartedOpsAt: null });
    r.openai.always("realtime.calls.hangup", ok(null));
    let line: string | null = null;
    for (let i = 0; i < 30 && line === null; i++) {
      const st = await route(r, stateRoute, body());
      if (st.status === 200) {
        // Never before blockedAt.
        if (st.body.proactive !== null) expect(await blockedAt()).not.toBeNull();
        line = st.body.proactive?.whisper.text ?? null;
      } else expect(st.body.error).toBe("BARRIER");
      await r.sched.runAll();
      r.clock.advance(5_000);
    }
    expect(line).toBe(said(await forgetJob(r)));
    const next = await route(r, stateRoute, body());
    expect(next.status).toBe(200);
    expect(isAck(next.body.proactive?.whisper.text)).toBe(false);
  });

  it("company and forget together: the fresh call inherits the narrowed audience and still says the acknowledgment (ruling 13)", async () => {
    const r = rig();
    r.openai.always("responses.create", ok(completed("All right.")));
    r.openai.always("realtime.calls.hangup", ok(null));
    const s = await openTestSession(r);
    await patchRecord<Session>(r.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
    r.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    expect((await post(r, { ...asrTurn(s.stamp, 1, "My cousin just sat down.", [{ itemId: "item_1", commitSeq: 1 }]), judge: "H" })).body.status).toBe("blocked");
    const swapped = await route(r, openRoute, { requestId: testId("swap"), initiator: "user", previousSessionId: s.sessionId, clientZone: "UTC", visitId: null });
    expect(swapped.body.audience).toBe("company");
    await patchRecord<Session>(r.store, UID, paths.session(UID, swapped.body.sessionId), { status: "active", registeredCallIds: ["rtc_b"], callId: "rtc_b" });
    r.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
    const stamp = swapped.body.ack.stamp;
    const res = await post(r, { ...asrTurn(stamp, 1, "forget what I said about my brother", [{ itemId: "item_2", commitSeq: 1 }], "final", 2), judge: "H" });
    expect(res.body).toMatchObject({ status: "blocked", permit: null, notes: [] });
    let fresh = null as null | Awaited<ReturnType<typeof freshOpen>>;
    for (let i = 0; i < 20; i++) {
      const o = await route(r, openRoute, { requestId: testId(`fresh-${i}`), initiator: "user", previousSessionId: swapped.body.sessionId, clientZone: "UTC", visitId: null });
      if (o.body.state === "connecting") {
        fresh = o;
        break;
      }
      expect(isAck(o.body.proactive?.whisper.text)).toBe(false);
      await r.sched.runAll();
      r.clock.advance(1_000);
    }
    expect(fresh).not.toBeNull();
    expect(fresh!.body.audience).toBe("company");
    expect(fresh!.body.proactive).toMatchObject({ permit: { kind: "postCommitControl", scope: "ack" }, whisper: { kind: "ack", text: said(await forgetJob(r)) } });
  });
});
