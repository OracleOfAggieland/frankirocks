// Brief 045 part S: the audience at an open. One block per finding, each the reviewer's sequence as a route test.
import { type Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, patchRecord, runScheduled } from "../testing/fakes";
import { asrTurn, typedTurn } from "../testing/session-fixtures";
import { PERSONAL_FACT } from "../testing/two-memories";
import { UID, closeWith, doorRig, postTurn, sessionOf } from "../testing/audience-doors";
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
