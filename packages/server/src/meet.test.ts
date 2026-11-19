// Brief 052 rulings 5 and 6: the first meeting's line on the open, offered at most twice, only while the Head has no
// name the owner gave, after a forget acknowledgment or the company line, never on a blocked open, in a crisis or an
// owner hold, once per request, again after "Start over", on a sample visit too (M-1), never on a typed open (M-5),
// and never again once a name was known.
import { serverRule, type CoreEpoch, type CoreState, FORGET_ACK_TEXTS, type Ledger, MEET_AGAIN_LINE, MEET_LINE, type Memory, NO_NAME_LINE, type Session, knownNameLine, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { fakeForgetResolve } from "./forget/resolve-port";
import { meetRowId, meetRule, meetSaidIn, meetTurnId } from "./meet";
import { ok } from "./openai/fake";
import { completed } from "./openai/responses";
import { openRoute } from "./routes/open";
import { turnRoute } from "./routes/turn";
import { paths } from "./store/paths";
import { decisionAnswer } from "./testing/decisions";
import { commitUserTurnForTest, insertMemoryForTest } from "./testing/extract-fixtures";
import { type TestRig, callRoute, patchRecord, settle, testRig } from "./testing/fakes";
import { resetAs } from "./testing/seed";
import { asrTurn, currentVisit } from "./testing/session-fixtures";

const UID = "owner-1";
const MEET = [MEET_LINE, MEET_AGAIN_LINE] as string[];

const open = async (r: TestRig, label: string, previousSessionId: string | null = null) =>
  (await callRoute(r, openRoute, { requestId: testId(label), initiator: "user", previousSessionId, clientZone: "UTC", visitId: await currentVisit(r) })).body;
const post = (r: TestRig, body: unknown) => settle(callRoute(r, turnRoute, body), r.clock, r.timers).then((x) => x.value);
const row = async (r: TestRig, n: 1 | 2) => (await r.store.get<Ledger>(UID, paths.ledger(UID, meetRowId(n, r.deps.hasher))))?.data ?? null;
const said = (body: { proactive: { whisper: { text: string } } | null }) => body.proactive?.whisper.text ?? null;
const stampOf = (body: { sessionId: string; deck: { epoch: number; policyRev: number; bundleRev: number; rulesRev: number } }) => ({
  sessionId: body.sessionId,
  epoch: body.deck.epoch,
  policyRev: body.deck.policyRev,
  bundleRev: body.deck.bundleRev,
  rulesRev: body.deck.rulesRev,
  generation: 1,
});

/** Saves the owner's own name the way an extract does: a Memory over the owner's committed turn (class U). */
async function saveName(r: TestRig, text: string): Promise<string> {
  const turn = await commitUserTurnForTest(r.store, UID, testId(`name-turn-${text}`), `Call me ${text}.`, r.clock, r.deps.hasher);
  return insertMemoryForTest(
    r.store,
    UID,
    turn,
    r.deps.hasher,
    { predicate: "identity.name", kind: "fact", subjectId: "self", args: {}, value: { kind: "text", text }, key: r.deps.hasher.id(["test-key", "identity.name", text]) },
    `name-${text}`,
  );
}

/** A forget on a live call, then opens until one gets past the barrier: that open's body. */
async function forgetThenOpen(r: TestRig, body: { sessionId: string; deck: { epoch: number; policyRev: number; bundleRev: number; rulesRev: number } }, label: string) {
  await patchRecord<Session>(r.store, UID, paths.session(UID, body.sessionId), { status: "active", registeredCallIds: [`rtc_${label}`], callId: `rtc_${label}` });
  r.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
  const res = await post(r, { ...asrTurn(stampOf(body), 1, "forget what I told you", [{ itemId: `item_${label}`, commitSeq: 1 }], "final", label), judge: "H" });
  expect(res.body.status).toBe("blocked");
  for (let i = 0; i < 20; i++) {
    const o = await open(r, `${label}-fresh-${i}`, body.sessionId);
    if (o.state === "connecting") return o;
    await r.sched.runAll();
    r.clock.advance(1_000);
  }
  throw new Error("no open got past the barrier");
}

function rig(): TestRig {
  const r = testRig();
  r.openai.always("responses.create", ok(completed("All right.")));
  r.openai.always("realtime.calls.hangup", ok(null));
  return r;
}

describe("the Server_Rule row for the meet line (brief 052 ruling 5)", () => {
  it("a private meet line gets a postCommitControl Permit of scope ack carrying the line; any other audience holds", () => {
    for (const line of [MEET_LINE, MEET_AGAIN_LINE] as const) {
      expect(serverRule(meetRule(line))).toMatchObject({ kind: "permit", permit: "postCommitControl", scope: "ack", notes: "none", line });
      expect(serverRule({ ...meetRule(line), audience: "company" })).toMatchObject({ kind: "hold", reasons: ["audience"] });
      expect(serverRule({ ...meetRule(line), audience: "unknown" }).kind).toBe("hold");
      // A call closed by narrowing still says nothing (row 1 comes first).
      expect(serverRule({ ...meetRule(line), narrowedHere: true })).toMatchObject({ kind: "hold", blocked: true });
    }
  });
});

describe("the first meeting on the open (brief 052 rulings 5 and 6)", () => {
  it("a fresh account's first open carries MEET_LINE under a Permit; the second MEET_AGAIN_LINE; the third neither, and delivery runs", async () => {
    const r = rig();
    const first = await open(r, "o1");
    expect(first.state).toBe("connecting");
    expect(first.proactive).toMatchObject({ turnId: meetTurnId(r.deps.hasher, first.sessionId), permit: { kind: "postCommitControl", scope: "ack" }, whisper: { kind: "ack", sens: "S0", text: MEET_LINE }, cards: [] });
    expect(first.proactive.permit.noteIds).toEqual([first.proactive.whisper.noteId]);
    expect(first.proactive.permit.stamp).toMatchObject({ ...stampOf(first), turnId: first.proactive.turnId });
    // The Permit's decision and the delivery row, which names the Session and the turn the line was said as.
    expect(await r.store.get(UID, paths.ledger(UID, first.proactive.permit.permitId))).not.toBeNull();
    const one = await row(r, 1);
    expect(one).toMatchObject({ kind: "decision", state: "complete", payload: { purpose: "proactive", audience: "private" } });
    expect(meetSaidIn(one)).toBe(first.sessionId);
    expect(one?.kind === "decision" && one.payload.acceptedRefs).toContainEqual({ type: "turn", id: first.proactive.turnId, parentId: first.sessionId, rev: 1 });
    expect(await row(r, 2)).toBeNull();
    // The Head says the owner hasn't given a name.
    expect(first.deck.head.text).toContain(NO_NAME_LINE);

    const second = await open(r, "o2");
    expect(said(second)).toBe(MEET_AGAIN_LINE);
    expect(meetSaidIn(await row(r, 2))).toBe(second.sessionId);
    expect(meetSaidIn(await row(r, 1))).toBe(first.sessionId);

    const before = r.logs.length;
    const third = await open(r, "o3");
    expect(third.state).toBe("connecting");
    expect(MEET).not.toContain(said(third));
    // The opening Moment path ran, as it does for any open with no line of its own.
    const phases = r.logs.slice(before).find((l) => l.event === "open.phases")!.fields;
    expect(phases).toHaveProperty("deliveryMs");
  });

  it("a retried requestId gives the same response and consumes one offer in all", async () => {
    const r = rig();
    const a = await open(r, "same");
    const b = await open(r, "same");
    expect(b).toEqual(a);
    expect(said(a)).toBe(MEET_LINE);
    expect(await row(r, 2)).toBeNull();
    expect(said(await open(r, "next"))).toBe(MEET_AGAIN_LINE);
  });

  it("an owner's own name means no meet line and both rows met; the Head names them", async () => {
    const r = rig();
    const id = await saveName(r, "Matt");
    const o = await open(r, "o1");
    expect(MEET).not.toContain(said(o));
    expect(o.deck.head.text).toContain(knownNameLine("Matt"));
    expect(o.deck.head.selectedRefs).toContainEqual(expect.objectContaining({ type: "memory", id }));
    for (const n of [1, 2] as const) {
      const x = await row(r, n);
      expect(x).toMatchObject({ kind: "decision", state: "complete", payload: { purpose: "proactive", acceptedRefs: [] } });
      expect(meetSaidIn(x)).toBeNull();
    }
    // A name known after one offer closes the second.
    const r2 = rig();
    expect(said(await open(r2, "o1"))).toBe(MEET_LINE);
    await saveName(r2, "Matt");
    expect(MEET).not.toContain(said(await open(r2, "o2")));
    expect(meetSaidIn(await row(r2, 2))).toBeNull();
    expect(meetSaidIn(await row(r2, 1))).not.toBeNull();
  });

  it("a blocked open, a crisis modifier and an owner hold each give no meet line and consume no offer", async () => {
    const r = rig();
    const now = tsFromMs(r.clock.read().opsClock.now);
    await open(r, "warm"); // makes the core documents; consumes offer 1
    expect(await row(r, 2)).toBeNull();
    await patchRecord<CoreEpoch>(r.store, UID, paths.core(UID, "epoch"), { barrier: { opId: testId("forget"), phase: "fence", startedAt: now, deadline: now, queuedOps: [] } });
    const blocked = await open(r, "blocked");
    expect(blocked).toMatchObject({ state: "blocked", proactive: null });
    expect(await row(r, 2)).toBeNull();
    await patchRecord<CoreEpoch>(r.store, UID, paths.core(UID, "epoch"), { barrier: null });

    const state = (await r.store.get<CoreState>(UID, paths.core(UID, "state")))!.data;
    await patchRecord<CoreState>(r.store, UID, paths.core(UID, "state"), { modifiers: { ...state.modifiers, crisis: tsFromMs(r.clock.read().worldClock.now) } });
    const held = await open(r, "held");
    expect(held.state).toBe("connecting");
    expect(MEET).not.toContain(said(held));
    expect(await row(r, 2)).toBeNull();
    await patchRecord<CoreState>(r.store, UID, paths.core(UID, "state"), { modifiers: { ...state.modifiers, crisis: null } });

    expect(said(await open(r, "after"))).toBe(MEET_AGAIN_LINE);
  });

  it("a company-inherited open says its own line and consumes no offer", async () => {
    const r = rig();
    const first = await open(r, "o1");
    expect(said(first)).toBe(MEET_LINE);
    await patchRecord<Session>(r.store, UID, paths.session(UID, first.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
    r.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    const narrowed = await post(r, { ...asrTurn(stampOf(first), 1, "My cousin just sat down.", [{ itemId: "item_1", commitSeq: 1 }]), judge: "H" });
    expect(narrowed.body.status).toBe("blocked");
    const swapped = await open(r, "swap", first.sessionId);
    expect(swapped.audience).toBe("company");
    expect(MEET).not.toContain(said(swapped));
    expect(swapped.deck.head.text).not.toContain(NO_NAME_LINE);
    expect(await row(r, 2)).toBeNull();
  });

  it("a forget acknowledgment comes first and consumes no offer; the next open makes the second offer", async () => {
    const r = rig();
    const turn = await commitUserTurnForTest(r.store, UID, testId("fact-turn"), "My dog is called Pip.", r.clock, r.deps.hasher);
    const target = await insertMemoryForTest(r.store, UID, turn, r.deps.hasher);
    r.deps.forgetResolve = fakeForgetResolve(() => ({ resolution: "exact", remove: [], candidateIds: [target], entityIds: [], topicKeys: [], needsMore: false, clarification: null }));
    const first = await open(r, "o1");
    expect(said(first)).toBe(MEET_LINE);
    const fresh = await forgetThenOpen(r, first, "f1");
    expect((FORGET_ACK_TEXTS as readonly string[]).includes(said(fresh) ?? "")).toBe(true);
    expect(await row(r, 2)).toBeNull();
    expect(said(await open(r, "o3"))).toBe(MEET_AGAIN_LINE);
  });

  it("Start over clears both rows with the rest of the ledger, and the first open after it carries MEET_LINE again", async () => {
    const r = rig();
    expect(said(await open(r, "o1"))).toBe(MEET_LINE);
    expect(said(await open(r, "o2"))).toBe(MEET_AGAIN_LINE);
    expect(MEET).not.toContain(said(await open(r, "o3")));
    expect((await resetAs(r, UID, "v1", "r1")).status).toBe(200);
    expect(await row(r, 1)).toBeNull();
    expect(await row(r, 2)).toBeNull();
    const fresh = await open(r, "v1-o1");
    expect(said(fresh)).toBe(MEET_LINE);
    expect(meetSaidIn(await row(r, 1))).toBe(fresh.sessionId);
    // A second Start over on the visit meets Franki again too.
    expect((await resetAs(r, UID, "v2", "r2")).status).toBe(200);
    expect(said(await open(r, "v2-o1"))).toBe(MEET_LINE);
  });

  it("contract question M-1, owner's ruling (intro first, demo line after): a sample visit is asked like any other account, and its opening Moment waits", async () => {
    const r = rig();
    expect((await resetAs(r, UID, "v1", "r1")).status).toBe(200);
    const first = await open(r, "o1");
    expect(said(first)).toBe(MEET_LINE);
    // The sample persona's own name is not the visitor's.
    expect(first.deck.head.text).toContain(NO_NAME_LINE);
    expect(said(await open(r, "o2"))).toBe(MEET_AGAIN_LINE);
    // Offers used up: the sample's scripted opening line, the wish, opens the third.
    const third = await open(r, "o3");
    expect(MEET).not.toContain(said(third));
    expect(said(third)).toMatch(/^Good luck at 2 PM: /);
  });

  it("contract question M-5: a typed open makes no offer and writes no row, its opening Moment path runs as before, and the call open after it carries MEET_LINE", async () => {
    const r = rig();
    const before = r.logs.length;
    const typed = (await callRoute(r, openRoute, { requestId: testId("t1"), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: await currentVisit(r), surface: "typed" })).body;
    expect(typed.state).toBe("connecting");
    expect(MEET).not.toContain(said(typed));
    expect(await row(r, 1)).toBeNull();
    expect(await row(r, 2)).toBeNull();
    // The open went on to delivery's opening line, as an open with no line of its own always has.
    expect(r.logs.slice(before).find((l) => l.event === "open.phases")!.fields).toHaveProperty("deliveryMs");
    // The Head is the same for both surfaces: it still says no name is given.
    expect(typed.deck.head.text).toContain(NO_NAME_LINE);
    // An open that names its surface `call` is asked, as one that names none is.
    const call = (await callRoute(r, openRoute, { requestId: testId("c1"), initiator: "user", previousSessionId: typed.sessionId, clientZone: "UTC", visitId: await currentVisit(r), surface: "call" })).body;
    expect(said(call)).toBe(MEET_LINE);
    expect(meetSaidIn(await row(r, 1))).toBe(call.sessionId);
    expect(said(await open(r, "o2"))).toBe(MEET_AGAIN_LINE);
  });

  it("contract question M-5 on a sample visit: a typed open leaves the wish to open its Session, as before the meeting existed", async () => {
    const r = rig();
    expect((await resetAs(r, UID, "v1", "r1")).status).toBe(200);
    const typed = (await callRoute(r, openRoute, { requestId: testId("t1"), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: await currentVisit(r), surface: "typed" })).body;
    expect(said(typed)).toMatch(/^Good luck at 2 PM: /);
    expect(await row(r, 1)).toBeNull();
  });

  it("after the name is saved and then forgotten, no open carries a meet line", async () => {
    const r = rig();
    const id = await saveName(r, "Matt");
    r.deps.forgetResolve = fakeForgetResolve(() => ({ resolution: "exact", remove: [], candidateIds: [id], entityIds: [], topicKeys: [], needsMore: false, clarification: null }));
    const first = await open(r, "o1");
    expect(MEET).not.toContain(said(first));
    expect(first.deck.head.text).toContain(knownNameLine("Matt"));
    const fresh = await forgetThenOpen(r, first, "f1");
    expect(fresh.deck.head.text).not.toContain("Matt");
    expect(fresh.deck.head.text).toContain(NO_NAME_LINE);
    expect(MEET).not.toContain(said(fresh));
    for (const label of ["o3", "o4"]) {
      const o = await open(r, label);
      expect(MEET).not.toContain(said(o));
      expect(o.deck.head.text).toContain(NO_NAME_LINE);
    }
  });
});
