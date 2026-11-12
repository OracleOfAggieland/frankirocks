// Brief 044, item 3: the walked-in tap. `/api/turn` takes a trusted tap for `company` or `alone`, with no text and
// no targets, and narrows or widens exactly as the owner's words do, with no model call and no Evidence written.
import type { CoreBundle, CoreEpoch, Ledger, Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { type TestRig, callRoute } from "../testing/fakes";
import { UID, doorRig, postTurn, runAll, sessionOf, stampAfter } from "../testing/audience-doors";
import { PERSONAL_FACT } from "../testing/two-memories";
import { turnRoute } from "./turn";

type Stamp = Parameters<typeof stampAfter>[0];

export function tapTurn(stamp: Stamp, verb: string, label: string, over: Record<string, unknown> = {}) {
  return {
    ...stamp,
    turnId: testId(`tap-${label}`),
    requestId: testId(`tapreq-${label}`),
    clientSeq: 1,
    source: "trustedTap",
    items: [],
    utteredWorldAt: "2026-11-03T12:00:00.000Z",
    transcript: "",
    transcriptState: "final",
    judge: "typed",
    pendingId: null,
    choiceId: null,
    supersedesRequestId: null,
    uiControl: { verb, targetIds: [] },
    ...over,
  };
}

const epochOf = async (rig: TestRig) => (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
const bundleOf = async (rig: TestRig) => (await rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data;
const modelCalls = (rig: TestRig) => rig.openai.requests.filter((r) => r.endpoint === "decisions.create" || r.endpoint === "responses.create").length;
const docs = (rig: TestRig) => (rig.store as unknown as { docs: Map<string, unknown> }).docs;
const stored = (rig: TestRig) => JSON.stringify([...docs(rig).entries()]);
const ledgerRows = (rig: TestRig) => [...docs(rig).entries()].filter(([path]) => path.startsWith(`users/${UID}/ledger/`)).map(([path, data]) => ({ path, data: data as Ledger }));

describe("the walked-in tap (brief 044, item 3)", () => {
  it("a company tap with no call narrows: company, policyRev + 1, the narrow Head, no Deck, no model, no Turn or Evidence", async () => {
    const { rig, s } = await doorRig(false);
    const before = await epochOf(rig);
    const models = modelCalls(rig);
    const evidence = rig.store.countUnder(`users/${UID}/evidence`);
    const res = await postTurn(rig, tapTurn(s.stamp, "company", "1"));
    expect(res.status).toBe(200);
    expect(res.body.deck).toBeNull();
    expect((await sessionOf(rig, s.sessionId)).audience).toBe("company");
    expect((await epochOf(rig)).policyRev).toBe(before.policyRev + 1);
    expect((await bundleOf(rig)).head!.text).not.toContain(PERSONAL_FACT);
    expect(modelCalls(rig)).toBe(models);
    expect(rig.store.countUnder(`users/${UID}/evidence`)).toBe(evidence);
    expect(rig.store.countUnder(`users/${UID}/sessions/${s.sessionId}/turns`)).toBe(0);
    // The Session's clientSeq is the owner's words': a tap takes none.
    expect((await sessionOf(rig, s.sessionId)).nextClientSeq).toBe(1);
  });

  it("a company tap with a call open hangs the call up: blocked, the Session closing, no Deck", async () => {
    const { rig, s } = await doorRig(true);
    const res = await postTurn(rig, tapTurn(s.stamp, "company", "1"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "blocked", deck: null, permit: null });
    const after: Session = await sessionOf(rig, s.sessionId);
    expect(after).toMatchObject({ audience: "company", status: "closing" });
    await runAll(rig);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(1);
  });

  it("two company taps in a row are one change", async () => {
    const { rig, s } = await doorRig(false);
    const before = await epochOf(rig);
    const first = await postTurn(rig, tapTurn(s.stamp, "company", "1"));
    const second = await postTurn(rig, tapTurn(stampAfter(s.stamp, first.body), "company", "2"));
    expect(second.status).toBe(200);
    expect((await epochOf(rig)).policyRev).toBe(before.policyRev + 1);
    expect((await sessionOf(rig, s.sessionId)).audience).toBe("company");
  });

  it("an alone tap widens a company Session back to private, with policyRev + 1 and the full Head", async () => {
    const { rig, s } = await doorRig(false);
    const first = await postTurn(rig, tapTurn(s.stamp, "company", "1"));
    const mid = await epochOf(rig);
    const res = await postTurn(rig, tapTurn(stampAfter(s.stamp, first.body), "alone", "2"));
    expect(res.status).toBe(200);
    expect((await sessionOf(rig, s.sessionId)).audience).toBe("private");
    expect((await epochOf(rig)).policyRev).toBe(mid.policyRev + 1);
    expect((await bundleOf(rig)).head!.text).toContain(PERSONAL_FACT);
  });

  it("one decision row records the tap, with its reason code and no words", async () => {
    const { rig, s } = await doorRig(false);
    const before = new Set(ledgerRows(rig).map((r) => r.path));
    await postTurn(rig, tapTurn(s.stamp, "company", "1"));
    const added = ledgerRows(rig).filter((r) => !before.has(r.path));
    // The request entry every mutation keeps, and the tap's one decision.
    expect(added.map((r) => r.data.kind).sort()).toEqual(["decision", "request"]);
    const decision = added.find((r) => r.data.kind === "decision")!.data as Extract<Ledger, { kind: "decision" }>;
    expect(decision.payload.reasonCodes).toEqual(["audience"]);
    expect(JSON.stringify(decision)).not.toContain("walked");
  });

  it("every other verb, and a tap with text or targets, is refused with nothing written", async () => {
    const { rig, s } = await doorRig(false);
    const snap = stored(rig);
    for (const body of [
      tapTurn(s.stamp, "forget", "f"),
      tapTurn(s.stamp, "quiet", "q"),
      tapTurn(s.stamp, "company", "t", { transcript: "my boss" }),
      tapTurn(s.stamp, "company", "x", { uiControl: { verb: "company", targetIds: [testId("m")] } }),
      tapTurn(s.stamp, "company", "u", { source: "typed" }),
    ]) {
      const res = await callRoute(rig, turnRoute, body);
      expect(res.status, JSON.stringify(body.uiControl)).toBe(400);
    }
    expect(stored(rig)).toBe(snap);
  });
});
