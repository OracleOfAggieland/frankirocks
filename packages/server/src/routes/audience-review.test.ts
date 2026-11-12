// Brief 035: the review of the audience wave. One block per finding, each the reviewer's sequence as a route test.
import { COMPANY_LINE, OPEN_LIMIT_MS, SWAP_LIMIT_MS, type CoreBundle, type CoreEpoch, type CoreRules, type Job, type SS, type Session, type Turn } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { never, ok } from "../openai/fake";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, patchRecord, runScheduled } from "../testing/fakes";
import { closeRoute } from "./close";
import { openRoute } from "./open";
import { stateRoute } from "./state";
import { asrTurn, typedTurn } from "../testing/session-fixtures";
import { PERSONAL_FACT } from "../testing/two-memories";
import { UID, doorRig, postTurn } from "../testing/audience-doors";
import { hangupJobId } from "../worker/hangup";
import { extractJobId } from "../worker/extract-jobs";
import { template } from "../testing/arb-rule-turns";
import { SWAP_WAIT_MS } from "../audience-swap";

/** The Stamp the browser would hold now: the stored core revisions. */
async function stampNow(rig: TestRig, sessionId: string): Promise<SS> {
  const e = (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  const r = (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
  const b = (await rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data;
  return { sessionId, epoch: e.epoch, policyRev: e.policyRev, bundleRev: b.bundleRev, rulesRev: r.rulesRev, generation: 1 } as SS;
}

const sessionOf = async (rig: TestRig, id: string) => (await rig.store.get<Session>(UID, paths.session(UID, id)))!.data;
const epochOf = async (rig: TestRig) => (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
const jobOf = (rig: TestRig, id: string) => rig.store.get<Job>(UID, paths.job(UID, hangupJobId(id as never, rig.deps.hasher)));
const voice = (stamp: Parameters<typeof asrTurn>[0], n: number, text: string, judge = "H", label: string | number = n) => ({ ...asrTurn(stamp, n, text, [{ itemId: `item_${label}`, commitSeq: n }], "final", label), judge });
const headText = (body: any): string => body?.deck?.head?.text ?? "";

describe("finding 1: a company hit through the Parse_Repair narrows", () => {
  it("the repair's hit stores company, raises policyRev, closes the Session and hangs up; the next turn is blocked", async () => {
    const { rig, s } = await doorRig(true);
    const before = await epochOf(rig);
    rig.openai.script("decisions.create", never(), ok(decisionAnswer({ company: 0.9 })));
    const first = await postTurn(rig, voice(s.stamp, 1, "My boss just walked in."));
    expect(first.body.status).toBe("clarify");
    await runScheduled(rig);
    const after = await sessionOf(rig, s.sessionId);
    expect(after.audience).toBe("company");
    expect(after.waitDeadline).not.toBeNull();
    expect(["closing", "closed"]).toContain(after.status);
    expect(after.parseLease).toBeNull();
    expect((await epochOf(rig)).policyRev).toBe(before.policyRev + 1);
    expect(await jobOf(rig, s.sessionId)).not.toBeNull();
    expect(rig.openai.requestsTo("realtime.calls.hangup").map((r) => (r.body as { callId: string }).callId)).toEqual(["rtc_a"]);
    // The next ordinary turn gets no private Head.
    rig.openai.script("decisions.create", ok(decisionAnswer()));
    const next = await postTurn(rig, voice(await stampNow(rig, s.sessionId), 2, "What's on for tonight?", "O"));
    expect(next.body?.status).not.toBe("ordinary");
    expect(headText(next.body)).not.toContain(PERSONAL_FACT);
  });

  it("a typed repair with no call open stores company and a narrow Head, with no hang-up", async () => {
    const { rig, s } = await doorRig(false);
    rig.openai.script("decisions.create", never(), ok(decisionAnswer({ company: 0.9 })));
    const first = await postTurn(rig, { ...voice(s.stamp, 1, "My boss just walked in."), source: "typed", items: [], judge: "typed" });
    expect(first.status).toBe(200);
    await runScheduled(rig);
    const after = await sessionOf(rig, s.sessionId);
    expect(after).toMatchObject({ audience: "company", waitDeadline: null });
    expect(await jobOf(rig, s.sessionId)).toBeNull();
    const bundle = (await rig.store.get<{ head: { text: string } }>(UID, paths.core(UID, "bundle")))!.data;
    expect(bundle.head.text).not.toContain(PERSONAL_FACT);
    expect(bundle.head.text).toContain("Audience: company.");
  });
});

describe("finding 2: a Superseding_Post with a company line narrows", () => {
  it("answers blocked, stores company, raises policyRev, closes the Session and writes the hangup Job", async () => {
    const { rig, s } = await doorRig(true);
    const before = await epochOf(rig);
    const first = await postTurn(rig, { ...asrTurn(s.stamp, 1, "", [{ itemId: "item_1", commitSeq: 1 }], "missing"), judge: "H" });
    expect(first.body.status).toBe("hold");
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    const late = await postTurn(rig, { ...voice(s.stamp, 1, "My boss just walked in."), requestId: testId("req-1-late"), supersedesRequestId: testId("req-1") });
    expect(late.status).toBe(200);
    expect(late.body).toMatchObject({ status: "blocked", permit: null, notes: [], deck: null });
    const after = await sessionOf(rig, s.sessionId);
    expect(after).toMatchObject({ audience: "company", status: "closing", parseLease: null });
    expect(after.waitDeadline).not.toBeNull();
    expect((await epochOf(rig)).policyRev).toBe(before.policyRev + 1);
    expect((await epochOf(rig)).activeSessionId).toBeNull();
    expect(await jobOf(rig, s.sessionId)).not.toBeNull();
    await runScheduled(rig);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(1);
  });
});

describe("finding 3: a typed crisis line with company and no call open narrows", () => {
  it("records company, raises policyRev, sets the crisis modifier, admits only S0 notes and leaves the hang-up out", async () => {
    const { rig, s } = await doorRig(false);
    const before = await epochOf(rig);
    rig.openai.script("decisions.create", ok(decisionAnswer({ crisis: 0.6, company: 0.9 })));
    const res = await postTurn(rig, typedTurn(s.stamp, 1, "My sister is reading this and I can't do this anymore."));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready", permit: { kind: "postCommitControl", scope: "ack" } });
    for (const n of res.body.notes) expect(n.sens).toBe("S0");
    expect(headText(res.body)).not.toContain(PERSONAL_FACT);
    const after = await sessionOf(rig, s.sessionId);
    expect(after).toMatchObject({ audience: "company", waitDeadline: null });
    expect(after.modifiers.crisis).not.toBeNull();
    expect(after.status).not.toBe("closing");
    expect((await epochOf(rig)).policyRev).toBe(before.policyRev + 1);
    expect(await jobOf(rig, s.sessionId)).toBeNull();
  });
});

describe("finding 4: a retained company candidate narrows whatever class was chosen", () => {
  it("forget chosen with company on a live call: blocked, company, closing and the hangup Job", async () => {
    const { rig, s } = await doorRig(true);
    rig.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.9, company: 0.9 })));
    const res = await postTurn(rig, voice(s.stamp, 1, "Forget that, my boss just walked in."));
    expect(res.body).toMatchObject({ status: "blocked", permit: null, notes: [] });
    expect(await sessionOf(rig, s.sessionId)).toMatchObject({ audience: "company", status: "closing" });
    expect(await jobOf(rig, s.sessionId)).not.toBeNull();
  });

  it("forget chosen with company, typed with no call: the company line and a narrow Head", async () => {
    const { rig, s } = await doorRig(false);
    rig.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.9, company: 0.9 })));
    const res = await postTurn(rig, typedTurn(s.stamp, 1, "Forget that, my cousin is reading over my shoulder."));
    expect(res.body.notes.map((n: { text: string }) => n.text)).toEqual([COMPANY_LINE]);
    expect(headText(res.body)).not.toContain(PERSONAL_FACT);
    expect((await sessionOf(rig, s.sessionId)).audience).toBe("company");
  });

  it("a weak company candidate with judge O doesn't narrow, but a sure quiet one beside it does", async () => {
    const { rig, s } = await doorRig(true);
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.5, quiet: 0.9 })));
    const res = await postTurn(rig, voice(s.stamp, 1, "Keep this between us, someone's here.", "O"));
    expect(res.body.status).toBe("blocked");
    expect((await sessionOf(rig, s.sessionId)).audience).toBe("company");
  });
});

describe("finding 7: a turn on a narrowed Session is kept, not thrown away", () => {
  it("an allergy said in the swap window answers blocked with no Permit, and its Turn, Evidence, Extract_Job and rule are stored", async () => {
    const { rig, s } = await doorRig(true);
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    const first = await postTurn(rig, voice(s.stamp, 1, "My boss just walked in."));
    expect(first.body.status).toBe("blocked");
    const tpl = template("self", "peanuts", "peanuts");
    rig.openai.script("decisions.create", ok(decisionAnswer({ hardRule: 0.9 })));
    rig.fastSlots.script((input) => ({ kind: "valid", out: { items: tpl.items(input.turn.eid), need: "none" }, ms: 120 }));
    const res = await postTurn(rig, voice(await stampNow(rig, s.sessionId), 2, tpl.text));
    expect(res.body).toMatchObject({ status: "blocked", permit: null, notes: [], deck: null });
    const turn = (await rig.store.get<Turn>(UID, paths.turn(UID, s.sessionId, testId("turn-2"))))?.data;
    expect(turn?.text).toBe(tpl.text);
    expect(await rig.store.get(UID, paths.evidence(UID, turn!.evidenceId!))).not.toBeNull();
    expect(await rig.store.get(UID, paths.job(UID, extractJobId(turn!.evidenceId! as never, rig.deps.hasher)))).not.toBeNull();
    const rules = (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
    expect(rules.allergies.some((r) => r.subjectId === "self" && r.code === "peanut" && r.state === "active")).toBe(true);
    expect((await sessionOf(rig, s.sessionId)).nextClientSeq).toBe(3);
  });

  it("a crisis line in the swap window sets the crisis modifier, so the next call opens with care", async () => {
    const { rig, s } = await doorRig(true);
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    await postTurn(rig, voice(s.stamp, 1, "My boss just walked in."));
    rig.openai.script("decisions.create", ok(decisionAnswer({ crisis: 0.6 })));
    const res = await postTurn(rig, voice(await stampNow(rig, s.sessionId), 2, "I can't do this anymore."));
    expect(res.body).toMatchObject({ status: "blocked", permit: null });
    expect((await sessionOf(rig, s.sessionId)).modifiers.crisis).not.toBeNull();
    expect(await rig.store.get(UID, paths.turn(UID, s.sessionId, testId("turn-2")))).not.toBeNull();
  });
});

describe("finding 8: a company turn that lands after an open replaced its Session still narrows", () => {
  it("records company on the old Session and narrows the Owner's active one, with the policyRev raise", async () => {
    const { rig, s } = await doorRig(true);
    const before = await epochOf(rig);
    const b = await callRoute(rig, openRoute, { requestId: testId("open-b"), initiator: "user", previousSessionId: s.sessionId, clientZone: "UTC", visitId: null });
    expect(b.status).toBe(200);
    const bId: string = b.body.sessionId;
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    const res = await postTurn(rig, voice(s.stamp, 1, "My boss just walked in."));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "blocked", permit: null, deck: null });
    expect((await sessionOf(rig, s.sessionId)).audience).toBe("company");
    expect(await sessionOf(rig, bId)).toMatchObject({ audience: "company", status: "closing" });
    expect(await jobOf(rig, bId)).not.toBeNull();
    expect((await epochOf(rig)).policyRev).toBe(before.policyRev + 1);
    // The open that takes the swap, naming either Session, starts company.
    for (const named of [s.sessionId, bId]) {
      const c = await callRoute(rig, openRoute, { requestId: testId(`open-c-${named}`), initiator: "user", previousSessionId: named, clientZone: "UTC", visitId: null });
      expect(headText(c.body)).not.toContain(PERSONAL_FACT);
    }
  });
});

describe("finding 9: the state route on a crisis-deferred Session gives no ack and no Deck", () => {
  it("after crisis with company (row 6), /api/session/state answers with ack null and deck null", async () => {
    const { rig, s } = await doorRig(true);
    rig.openai.script("decisions.create", ok(decisionAnswer({ crisis: 0.6, company: 0.9 })));
    const first = await postTurn(rig, voice(s.stamp, 1, "My cousin is here and I can't do this anymore."));
    expect(first.body.status).toBe("blocked");
    const stamp = await stampNow(rig, s.sessionId);
    const res = await callRoute(rig, stateRoute, { sessionId: s.sessionId, generation: 1, seen: { epoch: stamp.epoch, policyRev: stamp.policyRev, bundleRev: stamp.bundleRev, rulesRev: stamp.rulesRev }, ackStamp: null, speechStartedOpsAt: null });
    expect(res.status).toBe(200);
    expect(res.body.ack).toBeNull();
    expect(res.body.deck).toBeNull();
    expect((await sessionOf(rig, s.sessionId)).stateAck?.stamp.policyRev ?? 0).toBeLessThan(stamp.policyRev);
  });
});

const openNaming = (rig: TestRig, previousSessionId: string, label: string) => callRoute(rig, openRoute, { requestId: testId(label), initiator: "user", previousSessionId, clientZone: "UTC", visitId: null });
async function narrowedThenSwapped() {
  const { rig, s } = await doorRig(true);
  rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
  await postTurn(rig, voice(s.stamp, 1, "My boss just walked in."));
  const b = await openNaming(rig, s.sessionId, "open-b");
  expect(headText(b.body)).not.toContain(PERSONAL_FACT);
  const bId: string = b.body.sessionId;
  await patchRecord<Session>(rig.store, UID, paths.session(UID, bId), { status: "active", registeredCallIds: ["rtc_b"], callId: "rtc_b" });
  return { rig, a: s.sessionId, bId };
}

describe("finding 5: an inherited audience carries on with no close before the reconnect", () => {
  it("B, opened company from A, drops with no close; an open naming B starts company", async () => {
    const { rig, bId } = await narrowedThenSwapped();
    rig.clock.advance(30_000);
    const c = await openNaming(rig, bId, "open-c");
    expect(headText(c.body)).not.toContain(PERSONAL_FACT);
    expect((await sessionOf(rig, c.body.sessionId)).audience).toBe("company");
  });

  it("but after the Owner closed B themselves, an open naming B may start private", async () => {
    const { rig, bId } = await narrowedThenSwapped();
    const closed = await callRoute(rig, closeRoute, { requestId: testId("close-b"), sessionId: bId, generation: 1, reason: "user" });
    expect(closed.status).toBe(200);
    const c = await openNaming(rig, bId, "open-c");
    expect((await sessionOf(rig, c.body.sessionId)).audience).toBe("private");
  });
});

describe("finding 6: the swap wait covers the browser's swap, and an expired wait never yields private", () => {
  it("the server's swap wait is at least the browser's swap limit plus one open", () => {
    expect(SWAP_WAIT_MS).toBeGreaterThanOrEqual(SWAP_LIMIT_MS + OPEN_LIMIT_MS);
  });

  it("an open naming A 11 s after the hit, past the old 10 s wait, still starts narrow", async () => {
    const { rig, s } = await doorRig(true);
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    await postTurn(rig, voice(s.stamp, 1, "My boss just walked in."));
    await runScheduled(rig);
    rig.clock.advance(11_000);
    const b = await openNaming(rig, s.sessionId, "open-b");
    expect(headText(b.body)).not.toContain(PERSONAL_FACT);
    expect((await sessionOf(rig, b.body.sessionId)).audience).not.toBe("private");
  });

  it("past even the longer wait, the open starts unknown: the S0 Head and no swap line", async () => {
    const { rig, s } = await doorRig(true);
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    await postTurn(rig, voice(s.stamp, 1, "My boss just walked in."));
    await runScheduled(rig);
    rig.clock.advance(SWAP_WAIT_MS + 1);
    const b = await openNaming(rig, s.sessionId, "open-b");
    expect(headText(b.body)).not.toContain(PERSONAL_FACT);
    expect((await sessionOf(rig, b.body.sessionId)).audience).toBe("unknown");
    expect(b.body.proactive).toBeNull();
  });
});

describe("finding 13: the swapped Session inherits the crisis modifier", () => {
  it("row 6, then an open naming that Session: the new Session has the crisis modifier and no swap line", async () => {
    const { rig, s } = await doorRig(true);
    rig.openai.script("decisions.create", ok(decisionAnswer({ crisis: 0.6, company: 0.9 })));
    const first = await postTurn(rig, voice(s.stamp, 1, "My boss is here and I can't do this anymore."));
    expect(first.body.status).toBe("blocked");
    const crisisAt = (await sessionOf(rig, s.sessionId)).modifiers.crisis;
    expect(crisisAt).not.toBeNull();
    const b = await openNaming(rig, s.sessionId, "open-b");
    const next = await sessionOf(rig, b.body.sessionId);
    expect(next.audience).toBe("company");
    expect(next.modifiers.crisis).toEqual(crisisAt);
    expect(b.body.proactive).toBeNull();
  });
});
