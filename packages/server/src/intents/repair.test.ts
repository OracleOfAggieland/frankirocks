import { type CoreEpoch, type Ledger, type Session, type Turn } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { fail, never, ok } from "../openai/fake";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { StoreError } from "../store/errors";
import { decisionAnswer } from "../testing/decisions";
import { callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { REPAIR_DEADLINE_MS, repairDecisionId, runParseRepair } from "./repair";

const UID = "owner-1";
const items = (n: number) => [{ itemId: `item_${n}`, commitSeq: n }];
type Rig = ReturnType<typeof testRig>;

const post = (rig: Rig, body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);
const runScheduled = (rig: Rig) => settle(rig.sched.runAll(), rig.clock, rig.timers);
const session = async (rig: Rig, id: string) => (await rig.store.get<Session>(UID, paths.session(UID, id)))!.data;
const turn = async (rig: Rig, sessionId: string, label: number) => (await rig.store.get<Turn>(UID, paths.turn(UID, sessionId, testId(`turn-${label}`))))!.data;
const policyRev = async (rig: Rig) => (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data.policyRev;
const decisions = (rig: Rig) => rig.openai.requestsTo("decisions.create").length;

/** A Session whose turn 1 failed its parse as scripted; the repair is scheduled but not yet run. */
async function failedFirst(...script: Parameters<Rig["openai"]["script"]> extends [unknown, ...infer R] ? R : never) {
  const rig = testRig();
  const s = await openTestSession(rig);
  rig.openai.script("decisions.create", ...script);
  await post(rig, asrTurn(s.stamp, 1, "my dog loves the park", items(1)));
  return { rig, s };
}

describe("the Parse_Repair (R15.3–R15.6, R15.8; question 80)", () => {
  it("is scheduled only for deadline and transport failures", async () => {
    for (const [how, repaired] of [
      [never(), true],
      [fail(new Error("transport")), true],
      // An invalid answer is repaired too (review of the live run, item 4).
      [ok({ answers: [] }), true],
    ] as const) {
      const { rig } = await failedFirst(how);
      expect(decisions(rig)).toBe(1);
      await runScheduled(rig);
      expect(decisions(rig)).toBe(repaired ? 2 : 1);
    }
    // A missing transcript waits for its Superseding_Post, not a repair.
    const rig = testRig();
    const s = await openTestSession(rig);
    await post(rig, asrTurn(s.stamp, 1, "", items(1), "missing"));
    await runScheduled(rig);
    expect(decisions(rig)).toBe(0);
  });

  it("an oversize turn is not repaired, and stores unknown at once", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    await post(rig, asrTurn(s.stamp, 1, "x ".repeat(4000), items(1)));
    await runScheduled(rig);
    expect(decisions(rig)).toBe(0);
    const after = await session(rig, s.sessionId);
    expect([after.audience, after.parseLease]).toEqual(["unknown", null]);
  });

  it("runs with its own 2,000 ms deadline", async () => {
    const { rig, s } = await failedFirst(never(), never());
    const start = rig.clock.read().opsClock.now;
    await runScheduled(rig);
    expect(rig.clock.read().opsClock.now - start).toBe(REPAIR_DEADLINE_MS);
    expect((await session(rig, s.sessionId)).audience).toBe("unknown");
  });

  it("ordinary closes the gap with the stored audience untouched", async () => {
    const { rig, s } = await failedFirst(never());
    const before = await session(rig, s.sessionId);
    expect([before.committedParseSeq, before.lastClientSeq, before.parseLease?.clientSeq]).toEqual([0, 1, 1]);
    await runScheduled(rig);
    const after = await session(rig, s.sessionId);
    expect([after.committedParseSeq, after.parseLease, after.audience]).toEqual([1, null, "private"]);
    expect(await turn(rig, s.sessionId, 1)).toMatchObject({ parseState: "committed", uncertainSpeaker: 0.01 });
  });

  it("a weak late hit with judge O raises no policyRev: its route doesn't fire (review of the live run, item 5)", async () => {
    const { rig, s } = await failedFirst(never(), ok(decisionAnswer({ forget: 0.5 })));
    await patchRecord<Turn>(rig.store, UID, paths.turn(UID, s.sessionId, testId("turn-1")), { judge: "O" });
    const rev = await policyRev(rig);
    await runScheduled(rig);
    expect(await policyRev(rig)).toBe(rev);
    expect((await turn(rig, s.sessionId, 1)).parseState).toBe("committed");
    expect((await session(rig, s.sessionId)).committedParseSeq).toBe(1);
  });

  it("a hit raises policyRev and holds one decision for the turn, with no reply", async () => {
    const { rig, s } = await failedFirst(never(), ok(decisionAnswer({ forget: 0.95 })));
    const rev = await policyRev(rig);
    // Every record created from here on, to show the repair admits nothing.
    const created: { kind?: string; state?: string }[] = [];
    const transaction = rig.store.transaction.bind(rig.store);
    rig.store.transaction = ((uid: string, fn: (tx: Tx) => Promise<unknown>) =>
      transaction(uid, (tx) =>
        fn({ get: (p) => tx.get(p), query: (q) => tx.query(q), update: (p, r, e) => tx.update(p, r, e), create: (p, r) => (created.push(r as { kind?: string }), tx.create(p, r)) }),
      )) as typeof rig.store.transaction;
    await runScheduled(rig);
    expect(await policyRev(rig)).toBe(rev + 1);
    expect((await session(rig, s.sessionId)).committedParseSeq).toBe(1);
    const entry = await rig.store.get<Extract<Ledger, { kind: "decision" }>>(UID, paths.ledger(UID, repairDecisionId(rig.deps, s.sessionId, testId("turn-1"))));
    expect(entry!.data).toMatchObject({ kind: "decision", state: "blocked", payload: { acceptedRefs: [], heldRefs: [{ type: "turn", id: testId("turn-1") }] } });
    // No late reply: the only decision written is the held one.
    expect(created.filter((r) => r.kind === "decision")).toEqual([entry!.data]);
  });

  it("a failure stores unknown and keeps the gap", async () => {
    const { rig, s } = await failedFirst(never(), fail(new Error("again")));
    await runScheduled(rig);
    const after = await session(rig, s.sessionId);
    expect([after.audience, after.parseLease, after.committedParseSeq, after.lastClientSeq]).toEqual(["unknown", null, 0, 1]);
    expect((await turn(rig, s.sessionId, 1)).parseState).toBe("failed");
  });

  it("a stale lease token does nothing", async () => {
    const { rig, s } = await failedFirst(never());
    const before = await session(rig, s.sessionId);
    const t = await turn(rig, s.sessionId, 1);
    const result = await settle(runParseRepair(UID, rig.deps, { sessionId: s.sessionId, turnId: testId("turn-1"), token: testId("someone-else") }), rig.clock, rig.timers);
    expect(result.value).toBe("lostLease");
    expect(await session(rig, s.sessionId)).toEqual(before);
    expect(await turn(rig, s.sessionId, 1)).toEqual(t);
  });

  it("a parsed alone closes its own turn's gap (review of wave A, item 20)", async () => {
    const { rig, s } = await failedFirst(never(), ok(decisionAnswer({ alone: 0.9 })));
    await runScheduled(rig);
    const after = await session(rig, s.sessionId);
    expect([after.committedParseSeq, after.lastClientSeq, after.parseLease]).toEqual([1, 1, null]);
    expect((await turn(rig, s.sessionId, 1)).parseState).toBe("committed");
  });

  it("a parsed alone never moves the watermark past another turn's gap (R15.8)", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    // Turn 1's transcript is missing and never arrives; turn 2's parse misses its deadline, and its repair says alone.
    await post(rig, asrTurn(s.stamp, 1, "", items(1), "missing"));
    rig.openai.script("decisions.create", never(), ok(decisionAnswer({ alone: 0.9 })));
    await post(rig, asrTurn(s.stamp, 2, "it's just us now", items(2)));
    await runScheduled(rig);
    const after = await session(rig, s.sessionId);
    expect([after.committedParseSeq, after.lastClientSeq]).toEqual([0, 2]);
  });

  it("a typed U line is repaired too", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    rig.openai.script("decisions.create", never());
    await post(rig, typedTurn(s.stamp, 1, "my dog is called Pip"));
    await runScheduled(rig);
    expect((await session(rig, s.sessionId)).committedParseSeq).toBe(1);
  });
});

describe("the Parse_Repair under contention (review of wave A, item 18)", () => {
  /** Makes the next `n` transactions that write the turn's parse lose their compare-and-set at commit. */
  function loseRepairCommits(rig: Rig, n: number, before?: () => Promise<void>) {
    const inner = rig.store.transaction.bind(rig.store);
    let lost = 0;
    rig.store.transaction = (async (uid: string, fn: (tx: Tx) => Promise<unknown>) =>
      inner(uid, async (tx) => {
        let writesParse = false;
        const r = await fn({ ...tx, update: (p, rec, e) => ((writesParse ||= p.includes("/turns/") && (rec as Turn).parseState === "committed"), tx.update(p, rec, e)) });
        if (writesParse && lost < n) {
          lost++;
          await before?.();
          throw new StoreError("staleRevision", "a receipt won the race", p0);
        }
        return r;
      })) as typeof rig.store.transaction;
    const p0 = "session";
    return () => lost;
  }

  it("a lost compare-and-set is retried and the gap closes", async () => {
    const { rig, s } = await failedFirst(never());
    const lost = loseRepairCommits(rig, 2);
    await runScheduled(rig);
    expect(lost()).toBe(2);
    const after = await session(rig, s.sessionId);
    expect([after.committedParseSeq, after.parseLease, after.audience]).toEqual([1, null, "private"]);
    expect((await turn(rig, s.sessionId, 1)).parseState).toBe("committed");
  });

  it("each retry re-checks the lease: one gone by then commits nothing", async () => {
    const { rig, s } = await failedFirst(never());
    loseRepairCommits(rig, 1, () => patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { parseLease: null }));
    await runScheduled(rig);
    expect((await turn(rig, s.sessionId, 1)).parseState).toBe("failed");
  });
});