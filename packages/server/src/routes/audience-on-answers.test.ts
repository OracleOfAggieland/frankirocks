// Brief 045 part S, last item: the open's and the idle state poll's answers carry the Session's confirmed audience
// (the closed set the Session uses), so the company toggle can show what the server holds before any tap. An answer
// for a Session the caller does not own carries none, as before.
import { type Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { paths } from "../store/paths";
import { UID, closeWith, doorRig, postTurn } from "../testing/audience-doors";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, patchRecord } from "../testing/fakes";
import { typedTurn } from "../testing/session-fixtures";
import { openRoute } from "./open";
import { stateRoute } from "./state";

const openUnnamed = (rig: TestRig, label: string, token?: string) =>
  callRoute(rig, openRoute, { requestId: testId(label), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: null }, token === undefined ? {} : { token });
const poll = (rig: TestRig, id: string, deck: any, token?: string) =>
  callRoute(
    rig,
    stateRoute,
    { sessionId: id, generation: 1, seen: { epoch: deck.epoch, policyRev: deck.policyRev, bundleRev: deck.bundleRev, rulesRev: deck.rulesRev }, ackStamp: null, speechStartedOpsAt: null },
    token === undefined ? {} : { token },
  );

describe("brief 045 part S: the confirmed audience on the open's and the state poll's answers", () => {
  it("a private open says private", async () => {
    const { rig } = await doorRig(false);
    const b = await openUnnamed(rig, "open-b");
    expect(b.status).toBe(200);
    expect(b.body.audience).toBe("private");
  });

  it("a company line in words, then the next state answer says company", async () => {
    const { rig, s } = await doorRig(false);
    const before = await poll(rig, s.sessionId, s.deck);
    expect(before.status).toBe(200);
    expect(before.body.audience).toBe("private");
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    expect((await postTurn(rig, typedTurn(s.stamp, 1, "My cousin is reading over my shoulder."))).status).toBe(200);
    const after = await poll(rig, s.sessionId, s.deck);
    expect(after.status).toBe(200);
    expect(after.body.audience).toBe("company");
  });

  it("an open that inherits company says company", async () => {
    const { rig, s } = await doorRig(false);
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", audience: "company" });
    rig.clock.advance(1_000);
    const b = await openUnnamed(rig, "open-b");
    expect(b.body.audience).toBe("company");
  });

  it("the Owner's own hang-up widens: the next open says private", async () => {
    const { rig, s } = await doorRig(false);
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", audience: "company" });
    await closeWith(rig, s.sessionId, "user", "close-a");
    expect((await openUnnamed(rig, "open-b")).body.audience).toBe("private");
  });

  it("a state poll for a Session the caller does not own answers with no audience", async () => {
    const { rig, s } = await doorRig(false);
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { audience: "company" });
    const other = await poll(rig, s.sessionId, s.deck, "token:owner-2");
    expect(other.status).not.toBe(200);
    expect(other.body).not.toHaveProperty("audience");
  });
});
