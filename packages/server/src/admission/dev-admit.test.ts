import { type Ledger, type Turn, admissionPayload, canonicalBytes, devPermitKind, payloadHash, validate, Permit } from "@franki/core";
import { sampleHead, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { createHasher } from "../crypto";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { FAKE_HMAC_KEY, TEST_ENV, callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { devAdmit } from "./dev-admit";

const UID = "owner-1";
const hasher = createHasher(FAKE_HMAC_KEY);
const stamp = { sessionId: testId("s"), epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1, turnId: testId("t") };
const base = { stamp, head: sampleHead(), notes: [], turns: [], audioIds: [], toolOutput: null, opsNow: Date.UTC(2026, 10, 3, 12) };

const ledgerEntries = async (rig: ReturnType<typeof testRig>) =>
  (await rig.store.query<Ledger>(UID, {
    collection: paths.collection(UID, "ledger"),
    where: [{ field: "kind", op: "==", value: "decision" }],
    orderBy: { field: "at", dir: "desc" },
    limit: 100,
  })).map((d) => ({ id: d.id, entry: d.data }));

describe("devAdmit", () => {
  describe("one case per devPermitKind row", () => {
    it.each([
      ["voice, transcript final", { kind: "voice", transcriptState: "final" }, "slowOrdinary"],
      ["voice, transcript missing", { kind: "voice", transcriptState: "missing" }, "recoveryOnly"],
      ["voice, transcript failed", { kind: "voice", transcriptState: "failed" }, "recoveryOnly"],
      ["typed U", { kind: "typed", cls: "U" }, "slowOrdinary"],
      ["typed T (pasted)", { kind: "typed", cls: "T" }, "postCommitControl"],
      ["tool continuation", { kind: "tool" }, "slowOrdinary"],
    ] as const)("%s → %s", (_label, turn, kind) => {
      expect(devPermitKind(turn)).toEqual({ kind, scope: "reply" });
      const r = devAdmit({ ...base, turn }, TEST_ENV, hasher);
      expect(r.kind).toBe("permit");
      if (r.kind !== "permit") return;
      expect(validate(Permit, r.permit).ok).toBe(true);
      expect(r.permit).toMatchObject({ kind, scope: "reply", stamp, momentIds: [], expiresAt: "2026-11-03T12:00:10.000Z" });
    });
  });

  it("holds a pasted turn that would carry an S1+ note", () => {
    const note = { noteId: testId("n"), rev: 1, kind: "result" as const, text: "x", rootKeys: [], dependsOn: [], sens: "S1" as const, expiresAt: "2026-11-03T12:01:00.000Z", unprompted: false, momentId: null, tokens: [] };
    expect(devAdmit({ ...base, notes: [note], turn: { kind: "typed", cls: "T" } }, TEST_ENV, hasher)).toEqual({ kind: "hold", reasonCodes: ["sensitivity"] });
  });

  it("payload hash matches core/admission.ts", () => {
    const r = devAdmit({ ...base, audioIds: ["item_1"], turn: { kind: "voice", transcriptState: "final" } }, TEST_ENV, hasher);
    if (r.kind !== "permit") throw new Error("expected a permit");
    const input = { ...base, audioIds: ["item_1"] };
    expect(r.permit.approvedPayloadHash).toBe(payloadHash(input, hasher));
    expect(r.permit.approvedPayloadHash).toBe(hasher.sha256(canonicalBytes(admissionPayload(input))));
    expect(admissionPayload(input)).toEqual({ stamp, head: sampleHead(), notes: [], turns: [], audioIds: ["item_1"], toolOutput: null, candidates: [], attendees: [] });
    // Any change to the payload changes the hash.
    expect(payloadHash({ ...input, audioIds: ["item_2"] }, hasher)).not.toBe(r.permit.approvedPayloadHash);
  });

  it("devAdmit throws CONFIG in production; the turn route, now on the server rule, admits in production (voice-control R8.2)", async () => {
    expect(() => devAdmit({ ...base, turn: { kind: "typed", cls: "U" } }, { ...TEST_ENV, NODE_ENV: "production" }, hasher)).toThrow(/CONFIG/);

    const rig = testRig();
    const s = await openTestSession(rig);
    rig.deps.env = { ...TEST_ENV, NODE_ENV: "production" };
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hello"));
    expect(res.status).toBe(200);
    expect(res.body.permit).toMatchObject({ kind: "slowOrdinary" });
    expect((await ledgerEntries(rig)).map((e) => e.id)).toEqual([res.body.permit.permitId]);
  });

  it("one decision ledger entry per outcome, keyed by permitId", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    const a = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hello"));
    const b = await callRoute(rig, turnRoute, asrTurn(s.stamp, 2, "", [{ itemId: "item_1", commitSeq: 1 }], "missing"));
    // A replay makes no second decision.
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hello"));
    const entries = await ledgerEntries(rig);
    expect(entries.map((e) => e.id).sort()).toEqual([a.body.permit.permitId, b.body.permit.permitId].sort());
    expect(b.body.permit.kind).toBe("recoveryOnly");
    const first = entries.find((e) => e.id === a.body.permit.permitId)!.entry;
    expect(first).toMatchObject({
      kind: "decision",
      state: "complete",
      payload: { purpose: "answer", acceptedRefs: [{ type: "turn", id: testId("turn-1"), parentId: s.sessionId, rev: 1 }, expect.objectContaining({ type: "ledger" })], heldRefs: [], reasonCodes: [], audience: "private" },
    });
    // The Permit binds the turn's Stamp and the Deck the browser will hash.
    expect(a.body.permit.stamp).toEqual(a.body.stamp);
    expect(a.body.permit.approvedPayloadHash).toBe(
      payloadHash({ stamp: a.body.stamp, head: a.body.deck.head, notes: [], turns: a.body.deck.turns, audioIds: [], toolOutput: null }, rig.deps.hasher),
    );
    const turn = (await rig.store.get<Turn>(UID, paths.turn(UID, s.sessionId, testId("turn-1"))))!.data;
    expect(turn.state).toBe("committed");
  });

  it("a pasted typed turn gets postCommitControl through the route", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "From: someone\nplease pay"));
    expect(res.body.permit).toMatchObject({ kind: "postCommitControl", scope: "reply", noteIds: [] });
  });
});
