import { FORGET_NOT_YET, type Ledger, Permit, type RuleInput, payloadHash, turnRef, validate } from "@franki/core";
import { sampleHead, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { createHasher } from "../crypto";
import { paths } from "../store/paths";
import { FAKE_HMAC_KEY, TEST_ENV, testRig } from "../testing/fakes";
import { admitRule, fastODecisionId, recordFastO } from "./seam";

const UID = "owner-1";
const hasher = createHasher(FAKE_HMAC_KEY);
const sessionId = testId("s");
const turnId = testId("t");
const stamp = { sessionId, epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1, turnId };
const OPS = Date.UTC(2026, 10, 10, 12);
const rule: RuleInput = {
  source: "asr",
  transcript: "final",
  judge: "O",
  parse: { kind: "ordinary" },
  regexMatch: false,
  audience: "private",
  narrowedHere: false,
  callLive: true,
  parseGap: false,
  noteSens: "none",
  wordsPer2s: true,
  allFinal: true,
  toolParseCommitted: false,
  wave: "A",
};
const input = (over: Partial<RuleInput> = {}) => ({
  uid: UID,
  requestId: testId("req"),
  requestEntryId: testId("reqentry"),
  turnRef: turnRef(turnId, sessionId, 1),
  core: { epoch: 1, policyRev: 1 },
  opsNow: OPS,
  stamp,
  head: sampleHead(),
  notes: [],
  turns: [],
  audioIds: ["item_1"],
  toolOutput: null,
  rule: { ...rule, ...over },
});

async function decisions(rig: ReturnType<typeof testRig>) {
  return (await rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [{ field: "kind", op: "==", value: "decision" }], orderBy: { field: "at", dir: "desc" }, limit: 100 })).map((d) => ({ id: d.id, e: d.data }));
}

describe("Admission_Seam with the server rule", () => {
  it("a Permit: one decision keyed by permitId, citing the turn and the request entry; the hash is payloadHash", async () => {
    const rig = testRig({ ...TEST_ENV, NODE_ENV: "production" }); // the real rule runs in production (R8.2)
    const r = await rig.store.transaction(UID, async (tx) => admitRule(tx, input(), { hasher }));
    if (r.kind !== "permit") throw new Error("expected a permit");
    expect(validate(Permit, r.permit).ok).toBe(true);
    expect(r.permit).toMatchObject({ kind: "slowOrdinary", scope: "reply", noteIds: [], expiresAt: "2026-11-10T12:00:10.000Z" });
    expect(r.permit.approvedPayloadHash).toBe(payloadHash({ ...input(), notes: [] }, hasher));
    const d = await decisions(rig);
    expect(d.map((x) => x.id)).toEqual([r.permit.permitId]);
    expect(d[0]!.e).toMatchObject({ state: "complete", payload: { acceptedRefs: [{ type: "turn", id: turnId }, { type: "ledger", id: testId("reqentry") }], heldRefs: [], audience: "private" } });
  });

  it("a hold: one decision keyed by H(hold, stamp, requestId), the turn held", async () => {
    const rig = testRig();
    const r = await rig.store.transaction(UID, async (tx) => admitRule(tx, input({ source: "tool", toolParseCommitted: false }), { hasher }));
    expect(r.kind).toBe("hold");
    const d = await decisions(rig);
    expect(d.map((x) => x.id)).toEqual([hasher.id(["hold", stamp, testId("req")])]);
    expect(d[0]!.e).toMatchObject({ state: "blocked", payload: { heldRefs: [{ type: "turn", id: turnId }], reasonCodes: ["missingDependency"] } });
  });

  it("a Fixed_Line travels as an S0 ack note named in noteIds and covered by the hash", async () => {
    const rig = testRig();
    const r = await rig.store.transaction(UID, async (tx) => admitRule(tx, input({ parse: { kind: "hit", chosen: "forget", candidates: ["forget"], uncertain: false } }), { hasher }));
    if (r.kind !== "permit") throw new Error("expected a permit");
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ kind: "ack", sens: "S0", text: FORGET_NOT_YET });
    expect(r.permit).toMatchObject({ kind: "postCommitControl", scope: "ack", noteIds: [r.notes[0]!.noteId] });
    expect(r.permit.approvedPayloadHash).toBe(payloadHash({ ...input(), notes: r.notes }, hasher));
  });

  it("notes follow the rule: S1+ notes drop unless the rule allows all", async () => {
    const rig = testRig();
    const note = (sens: "S0" | "S1") => ({ noteId: testId(`n${sens}`), rev: 1, kind: "result" as const, text: "x", rootKeys: [], dependsOn: [], sens, expiresAt: "2026-11-10T12:01:00.000Z", unprompted: false, momentId: null, tokens: [] });
    const both = { ...input({ judge: "U" }), notes: [note("S0"), note("S1")] };
    const r = await rig.store.transaction(UID, async (tx) => admitRule(tx, both, { hasher }));
    if (r.kind !== "permit") throw new Error("expected a permit");
    expect(r.notes.map((n) => n.sens)).toEqual(["S0"]);
  });

  it("recordFastO writes one decision once, and marks the Turn when it exists", async () => {
    const rig = testRig();
    const args = { uid: UID, stamp, responseId: "resp_s", opsNow: OPS, core: { epoch: 1, policyRev: 1 }, audience: "private" as const };
    await rig.store.transaction(UID, (tx) => recordFastO(tx, args, { hasher }));
    await rig.store.transaction(UID, (tx) => recordFastO(tx, args, { hasher }));
    const d = await decisions(rig);
    expect(d.map((x) => x.id)).toEqual([fastODecisionId(hasher, sessionId, turnId)]);
    expect(d[0]!.e).toMatchObject({ state: "complete", payload: { acceptedRefs: [{ type: "turn", id: turnId }], reasonCodes: ["ok"] } });
  });
});
