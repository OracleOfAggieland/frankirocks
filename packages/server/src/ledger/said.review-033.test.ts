/** The review of the Gate's ledger writers (brief 033 finding 11). */
import { type GateResult, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { testRig } from "../testing/fakes";
import { writeGateDecision, writeSaid } from "./said";

const UID = "owner-1";
const hold: GateResult = { verdict: "hold", form: null, render: null, carveOut: null, mustSay: null, fixedLine: null, reasons: ["ceiling"] };
const say: GateResult = { ...hold, verdict: "say", form: "item", render: "free", reasons: ["ok"] };
const row = (o: { turnId?: string | null; momentId?: string | null } = {}) => ({
  candidateId: testId("cand"),
  refs: [],
  noteIds: [testId("note")],
  momentId: o.momentId ?? null,
  sessionId: testId("s"),
  turnId: o.turnId ?? null,
  audience: "private" as const,
  permitKind: "fastO" as const,
});

describe("finding 11: every Gate row has a scope, and a bad row is an error", () => {
  it("refuses a decision with neither a turn nor a moment", async () => {
    const rig = testRig();
    const at = { uid: UID, now: tsFromMs(rig.clock.read().opsClock.now), epoch: 1, policyRev: 1 };
    await expect(rig.store.transaction(UID, (tx) => writeGateDecision(tx, rig.deps.hasher, at, hold, row()))).rejects.toThrow();
    expect(await rig.store.transaction(UID, (tx) => writeGateDecision(tx, rig.deps.hasher, at, hold, row({ momentId: testId("m") })))).not.toBeNull();
  });

  it("throws when the entry fails validation instead of returning null without a word", async () => {
    const rig = testRig();
    const at = { uid: UID, now: tsFromMs(rig.clock.read().opsClock.now), epoch: 1, policyRev: 1 };
    const bad = { ...hold, reasons: ["notAReason" as never] };
    await expect(rig.store.transaction(UID, (tx) => writeGateDecision(tx, rig.deps.hasher, at, bad, row({ turnId: testId("t") })))).rejects.toThrow();
    await expect(rig.store.transaction(UID, (tx) => writeSaid(tx, rig.deps.hasher, at, { ...say, reasons: ["notAReason" as never] }, row({ turnId: testId("at") }), { receipt: { kind: "transcript", responseId: "resp_1", momentIds: [], noteIds: [testId("note")], text: "Pip." }, note: { noteId: testId("note"), text: "Pip.", momentId: null } }))).rejects.toThrow();
  });
});
