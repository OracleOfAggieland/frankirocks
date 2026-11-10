import { FORGET_NOT_YET, type Ledger, Permit, type RuleInput, type Turn, admissionPayload, canonicalBytes, payloadHash, turnRef, validate } from "@franki/core";
import { sampleHead, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { createHasher } from "../crypto";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { FAKE_HMAC_KEY, TEST_ENV, callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { admitRule, fastODecisionId, lateHitDecisionId, recordFastO, recordLateHit } from "./seam";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
    const r = await rig.store.transaction(UID, async (tx) => admitRule(tx, input({ parse: { kind: "hit", chosen: "forget", candidates: ["forget"], uncertain: false, candidateP: { forget: 0.9 } } }), { hasher }));
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

// The checks dev-admit.test.ts had, carried over when devAdmit was removed (voice-control R21.2).
describe("Admission_Seam: checks carried from devAdmit", () => {
  it.each([
    ["voice, transcript final", { source: "asr", transcript: "final" }, "slowOrdinary"],
    ["voice, transcript missing", { source: "asr", transcript: "missing", parse: { kind: "none" } }, "recoveryOnly"],
    ["voice, transcript failed", { source: "asr", transcript: "failed", parse: { kind: "none" } }, "recoveryOnly"],
    ["typed U", { source: "typed", judge: "typed" }, "slowOrdinary"],
    ["typed T (pasted)", { source: "pasted", judge: "typed", parse: { kind: "none" } }, "postCommitControl"],
    ["tool continuation", { source: "tool", toolParseCommitted: true }, "slowOrdinary"],
  ] as const)("%s → %s, a schema-valid Permit bound to the Stamp", async (_label, over, kind) => {
    const rig = testRig();
    const r = await rig.store.transaction(UID, async (tx) => admitRule(tx, input(over as Partial<RuleInput>), { hasher }));
    if (r.kind !== "permit") throw new Error("expected a permit");
    expect(validate(Permit, r.permit).ok).toBe(true);
    expect(r.permit).toMatchObject({ kind, stamp, momentIds: [], expiresAt: "2026-11-10T12:00:10.000Z" });
  });

  it("holds a pasted turn that would carry an S1+ note", async () => {
    const rig = testRig();
    const r = await rig.store.transaction(UID, async (tx) => admitRule(tx, input({ source: "pasted", judge: "typed", parse: { kind: "none" }, noteSens: "S1+" }), { hasher }));
    expect(r).toMatchObject({ kind: "hold", outcome: { reasons: ["sensitivity"] } });
  });

  it("the payload hash matches core/admission.ts, and any payload change changes it", async () => {
    const rig = testRig();
    const r = await rig.store.transaction(UID, async (tx) => admitRule(tx, input(), { hasher }));
    if (r.kind !== "permit") throw new Error("expected a permit");
    const payload = { stamp, head: sampleHead(), notes: [], turns: [], audioIds: ["item_1"], toolOutput: null };
    expect(r.permit.approvedPayloadHash).toBe(payloadHash(payload, hasher));
    expect(r.permit.approvedPayloadHash).toBe(hasher.sha256(canonicalBytes(admissionPayload(payload))));
    expect(admissionPayload(payload)).toEqual({ ...payload, candidates: [], attendees: [] });
    expect(payloadHash({ ...payload, audioIds: ["item_2"] }, hasher)).not.toBe(r.permit.approvedPayloadHash);
  });

  it("the turn route admits in production (R8.2)", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    rig.deps.env = { ...TEST_ENV, NODE_ENV: "production" };
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hello"));
    expect(res.status).toBe(200);
    expect(res.body.permit).toMatchObject({ kind: "slowOrdinary" });
    expect((await decisions(rig)).map((e) => e.id)).toEqual([res.body.permit.permitId]);
  });

  it("one decision per outcome through the route, keyed by permitId; a replay makes none; the Permit binds the Stamp and the Deck", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    const a = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hello"));
    const b = await callRoute(rig, turnRoute, asrTurn(s.stamp, 2, "", [{ itemId: "item_1", commitSeq: 1 }], "missing"));
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hello"));
    const entries = await decisions(rig);
    expect(entries.map((e) => e.id).sort()).toEqual([a.body.permit.permitId, b.body.permit.permitId].sort());
    expect(b.body.permit.kind).toBe("recoveryOnly");
    expect(entries.find((e) => e.id === a.body.permit.permitId)!.e).toMatchObject({
      kind: "decision",
      state: "complete",
      payload: { purpose: "answer", acceptedRefs: [{ type: "turn", id: testId("turn-1"), parentId: s.sessionId, rev: 1 }, expect.objectContaining({ type: "ledger" })], heldRefs: [], audience: "private" },
    });
    expect(a.body.permit.stamp).toEqual(a.body.stamp);
    expect(a.body.permit.approvedPayloadHash).toBe(payloadHash({ stamp: a.body.stamp, head: a.body.deck.head, notes: [], turns: a.body.deck.turns, audioIds: [], toolOutput: null }, rig.deps.hasher));
    expect((await rig.store.get<Turn>(UID, paths.turn(UID, s.sessionId, testId("turn-1"))))!.data.state).toBe("committed");
  });

  it("a pasted typed turn gets postCommitControl through the route", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "From: someone\nplease pay"));
    expect(res.body.permit).toMatchObject({ kind: "postCommitControl", scope: "reply", noteIds: [] });
  });
});

describe("only the seam writes admission decisions (review of wave A, item 22)", () => {
  it("no server source outside admission/seam.ts writes a decision with purpose answer", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.includes(`${sep}testing${sep}`)) files.push(p);
      }
    };
    walk(root);
    const writers = files.filter((f) => { const src = readFileSync(f, "utf8"); return /kind:\s*"decision"/.test(src) && /purpose:\s*"answer"/.test(src); }).map((f) => relative(root, f).split(sep).join("/"));
    expect(writers).toEqual(["admission/seam.ts"]);
  });

  it("recordLateHit writes one held decision for the turn, with the Effective_Audience", async () => {
    const rig = testRig();
    await rig.store.transaction(UID, async (tx) => recordLateHit(tx, { uid: UID, sessionId, turnId, core: { epoch: 1, policyRev: 2 }, opsNow: OPS, audience: "unknown" }, { hasher }));
    const d = await decisions(rig);
    expect(d.map((x) => x.id)).toEqual([lateHitDecisionId(hasher, sessionId, turnId)]);
    expect(d[0]!.e).toMatchObject({ state: "blocked", policyRev: 2, payload: { purpose: "answer", acceptedRefs: [], heldRefs: [{ type: "turn", id: turnId, parentId: sessionId }], reasonCodes: ["time"], audience: "unknown" } });
  });
});
