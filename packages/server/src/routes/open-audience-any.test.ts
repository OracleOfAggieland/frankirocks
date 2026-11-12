// Brief 045 part S: the audience at an open. One block per finding, each the reviewer's sequence as a route test.
import { COMPANY_LINE, type Session, holdsOf, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, patchRecord, runScheduled, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { asrTurn, typedTurn } from "../testing/session-fixtures";
import { PERSONAL_FACT } from "../testing/two-memories";
import { UID, closeWith, doorRig, postTurn, sessionOf } from "../testing/audience-doors";
import { HOLD_CARRY_MS } from "../audience-swap";
import { signalsOf } from "./delivery-wire";
import { openRoute } from "./open";

const headText = (body: any): string => body?.deck?.head?.text ?? "";
/** An open that names no previous Session: the typed bar's, or voice after a reload. */
const openUnnamed = (rig: TestRig, label: string) => callRoute(rig, openRoute, { requestId: testId(label), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: null });

describe("finding 2: an open that names no previous Session still inherits a narrowed audience", () => {
  it("Session A active and company; a minute later an open naming nothing starts narrow, with the S0 Head", async () => {
    const { rig, s } = await doorRig(false);
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", audience: "company" });
    rig.clock.advance(60_000);
    const b = await openUnnamed(rig, "open-b");
    expect(b.status).toBe(200);
    expect((await sessionOf(rig, b.body.sessionId)).audience).not.toBe("private");
    expect(headText(b.body)).not.toContain(PERSONAL_FACT);
  });

  it("a typed company line, then an open naming nothing (the typed bar always sends null) starts narrow", async () => {
    const { rig, s } = await doorRig(false);
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    await postTurn(rig, typedTurn(s.stamp, 1, "My cousin is reading over my shoulder."));
    const b = await openUnnamed(rig, "open-b");
    expect((await sessionOf(rig, b.body.sessionId)).audience).not.toBe("private");
    expect(headText(b.body)).not.toContain(PERSONAL_FACT);
  });

  it("a company hit hung up the call; an open naming nothing (voice after a reload) starts narrow", async () => {
    const { rig, s } = await doorRig(true);
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    await postTurn(rig, { ...asrTurn(s.stamp, 1, "My boss just walked in.", [{ itemId: "item_1", commitSeq: 1 }]), judge: "H" });
    await runScheduled(rig);
    expect((await sessionOf(rig, s.sessionId)).status).toBe("closed");
    const b = await openUnnamed(rig, "open-b");
    expect((await sessionOf(rig, b.body.sessionId)).audience).not.toBe("private");
    expect(headText(b.body)).not.toContain(PERSONAL_FACT);
  });

  it("the Owner's own hang-up still widens: after a user close, an open naming nothing starts private", async () => {
    const { rig, s } = await doorRig(false);
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", audience: "company" });
    const c = await closeWith(rig, s.sessionId, "user", "close-a");
    expect(c.status).toBe(200);
    const b = await openUnnamed(rig, "open-b");
    expect((await sessionOf(rig, b.body.sessionId)).audience).toBe("private");
    expect(headText(b.body)).toContain(PERSONAL_FACT);
  });
});

describe("finding 4: an open that inherits a narrowed audience opens with the swap line or nothing", () => {
  const ZONE = "America/Chicago";
  const VISIT = testId("visit-v1");
  const openOnClone = (rig: TestRig, previousSessionId: string | null, label: string) =>
    callRoute(rig, openRoute, { requestId: testId(label), initiator: "user", previousSessionId, clientZone: ZONE, visitId: VISIT });

  it("a company Session's wait expired; the open naming it is unknown and says nothing, not the S1 wish", async () => {
    const rig = testRig();
    await resetAs(rig, UID, "v1", "r1", ZONE);
    const a = await openOnClone(rig, null, "open-a");
    expect(a.body.proactive?.whisper.text).toBe("Good luck at 2 PM: Tessellate Labs final interview.");
    const ops = rig.clock.read().opsClock.now;
    await patchRecord<Session>(rig.store, UID, paths.session(UID, a.body.sessionId), { status: "closed", audience: "company", waitDeadline: tsFromMs(ops - 1_000) });
    rig.clock.advance(1_000);
    const b = await openOnClone(rig, a.body.sessionId, "open-b");
    expect((await sessionOf(rig, b.body.sessionId)).audience).toBe("unknown");
    expect(b.body.proactive).toBeNull();
  });

  it("an open naming nothing after a company Session gets the swap line, never delivery's opener", async () => {
    const rig = testRig();
    await resetAs(rig, UID, "v1", "r1", ZONE);
    const a = await openOnClone(rig, null, "open-a");
    await patchRecord<Session>(rig.store, UID, paths.session(UID, a.body.sessionId), { status: "active", audience: "company" });
    rig.clock.advance(1_000);
    const b = await openOnClone(rig, null, "open-b");
    expect((await sessionOf(rig, b.body.sessionId)).audience).toBe("company");
    expect(b.body.proactive === null || b.body.proactive.whisper.text === COMPANY_LINE).toBe(true);
    expect(b.body.proactive?.whisper.text ?? null).not.toBe("Good luck at 2 PM: Tessellate Labs final interview.");
  });
});

describe("finding 5: a crisis or life-change hold crosses a hang-up", () => {
  it('"My mom passed away", the Owner hangs up, and 16 minutes later the next Session holds insights, celebrations and asks', async () => {
    const { rig, s } = await doorRig(false);
    rig.openai.script("decisions.create", ok(decisionAnswer({})));
    const t = await postTurn(rig, typedTurn(s.stamp, 1, "My mom passed away last night."));
    expect(t.status).toBe(200);
    expect(holdsOf(signalsOf(await sessionOf(rig, s.sessionId), rig.clock.read().opsClock.now, null)).transition).toBe(true);
    expect((await closeWith(rig, s.sessionId, "user", "close-a")).status).toBe(200);
    rig.clock.advance(16 * 60_000);
    rig.clock.setWorld(rig.clock.read().worldClock.now + 16 * 60_000);
    const b = await openUnnamed(rig, "open-b");
    const next = await sessionOf(rig, b.body.sessionId);
    expect(next.audience).toBe("private");
    expect(holdsOf(signalsOf(next, rig.clock.read().opsClock.now, null)).transition).toBe(true);
  });

  it("past HOLD_CARRY_MS of world time, the next Session holds nothing", async () => {
    const { rig, s } = await doorRig(false);
    rig.openai.script("decisions.create", ok(decisionAnswer({})));
    await postTurn(rig, typedTurn(s.stamp, 1, "My mom passed away last night."));
    await closeWith(rig, s.sessionId, "user", "close-a");
    rig.clock.advance(HOLD_CARRY_MS + 60_000);
    rig.clock.setWorld(rig.clock.read().worldClock.now + HOLD_CARRY_MS + 60_000);
    const b = await openUnnamed(rig, "open-b");
    expect(holdsOf(signalsOf(await sessionOf(rig, b.body.sessionId), rig.clock.read().opsClock.now, null)).transition).toBe(false);
  });
});

describe("finding 11: on a clone, an open that names no visit is STALE", () => {
  it("a fresh tab on a clone, before its own reset answers, opens nothing and answers STALE", async () => {
    const rig = testRig();
    await resetAs(rig, UID, "v1", "r1", "America/Chicago");
    const res = await callRoute(rig, openRoute, { requestId: testId("open-fresh"), initiator: "user", previousSessionId: null, clientZone: "America/Chicago", visitId: null });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("STALE");
    const sessions = await rig.store.query<Session>(UID, { collection: paths.collection(UID, "sessions"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
    expect(sessions).toEqual([]);
  });
});
