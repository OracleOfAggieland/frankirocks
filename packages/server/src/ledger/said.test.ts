/** The Gate's ledger writers and the Deck and audience seams (brief 024). */
import { type Deck, type GateResult, type Ledger, type W, tsFromMs } from "@franki/core";
import { sampleHead, sampleSession, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { gateAudience } from "../audience";
import { issueDeck, withWhispers } from "../deck";
import { paths } from "../store/paths";
import { testRig } from "../testing/fakes";
import { gateRowId, readWhySaid, writeGateDecision, writeSaid } from "./said";

const UID = "owner-1";
const say: GateResult = { verdict: "say", form: "item", render: "free", carveOut: null, mustSay: null, fixedLine: null, reasons: ["ok"] };
const hold: GateResult = { verdict: "hold", form: null, render: null, carveOut: null, mustSay: null, fixedLine: null, reasons: ["ceiling", "sensitivity"] };
const row = (turnId: string) => ({ candidateId: testId("cand"), refs: [], noteIds: [testId("note")], momentId: null, sessionId: testId("s"), turnId, audience: "private" as const, permitKind: "fastO" as const });

describe("gate ledger writers", () => {
  it("writes a held row once, and nothing for a say", async () => {
    const rig = testRig();
    const at = { uid: UID, now: tsFromMs(rig.clock.read().opsClock.now), epoch: 1, policyRev: 1 };
    const ids = await rig.store.transaction(UID, async (tx) => [await writeGateDecision(tx, rig.deps.hasher, at, hold, row(testId("ut"))), await writeGateDecision(tx, rig.deps.hasher, at, say, row(testId("ut")))]);
    expect(ids[1]).toBeNull();
    const again = await rig.store.transaction(UID, (tx) => writeGateDecision(tx, rig.deps.hasher, at, hold, row(testId("ut"))));
    expect(again).toBe(ids[0]);
    const doc = await rig.store.get<Ledger>(UID, paths.ledger(UID, ids[0]!));
    expect(doc?.data).toMatchObject({ kind: "gate", state: "complete", payload: { outcome: "held", reasonCodes: ["ceiling", "sensitivity"] } });
  });

  it("answers why from the said row of the assistant Turn, and nothing without one", async () => {
    const rig = testRig();
    const at = { uid: UID, now: tsFromMs(rig.clock.read().opsClock.now), epoch: 1, policyRev: 1 };
    const turn = testId("at");
    expect(await rig.store.snapshot(UID, (r) => readWhySaid(r, rig.deps.hasher, UID, turn, testId("note")))).toBeNull();
    const id = await rig.store.transaction(UID, (tx) => writeSaid(tx, rig.deps.hasher, at, { ...say, reasons: ["ok", "mustSay"] }, row(turn), "idTagged"));
    expect(id).toBe(gateRowId(rig.deps.hasher, UID, { outcome: "said", candidateId: testId("cand"), turnId: turn, momentId: null, noteIds: [testId("note")] }));
    expect(await rig.store.snapshot(UID, (r) => readWhySaid(r, rig.deps.hasher, UID, turn, testId("note")))).toMatchObject({ entryId: id, outcome: "said", reasonCodes: ["ok", "mustSay"] });
    // No match, no row.
    expect(await rig.store.transaction(UID, (tx) => writeSaid(tx, rig.deps.hasher, at, say, row(testId("at2")), "none"))).toBeNull();
  });
});

describe("deck whispers", () => {
  const OPS = Date.parse("2026-11-12T17:00:00.000Z");
  const note = (n: string, sens: W["sens"], expiresInMs = 30_000): W => ({
    noteId: testId(n),
    rev: 1,
    kind: "truth",
    text: "Pip. One line, no recap.",
    rootKeys: [],
    dependsOn: [],
    sens,
    expiresAt: tsFromMs(OPS + expiresInMs),
    unprompted: true,
    momentId: null,
    tokens: ["Pip"],
  });
  const deck = (): Deck => issueDeck({ sessionId: testId("s"), epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1 }, sampleHead(), OPS);

  it("carries S0 notes only, and flags a waiting S1+ note without carrying it", () => {
    const d = withWhispers(deck(), [note("a", "S0"), note("b", "S1"), note("c", "S2"), note("a", "S0"), note("x", "S0", -1)], OPS);
    expect(d.whispers.map((w) => w.noteId)).toEqual([testId("a")]);
    expect(d.noteWaiting).toBe(true);
    expect(withWhispers(deck(), [note("a", "S0")], OPS).noteWaiting).toBe(false);
  });
});

describe("gate audience", () => {
  it("is unknown during a parse repair, and turns modifiers on when set", () => {
    const OPS = Date.parse("2026-11-12T17:00:00.000Z");
    const s = sampleSession({ audience: "private", parseLease: { clientSeq: 1, token: testId("tok"), until: tsFromMs(OPS + 1_000) } });
    expect(gateAudience(s, OPS)).toEqual({ audience: "unknown", modifiers: { rushed: false, crisis: false } });
    const r = sampleSession({ audience: "private", modifiers: { rushed: tsFromMs(OPS), crisis: null } });
    expect(gateAudience(r, OPS)).toEqual({ audience: "private", modifiers: { rushed: true, crisis: false } });
  });
});
