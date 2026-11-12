import { describe, expect, it } from "vitest";
import { tsFromMs } from "../schema/primitives";
import { validate } from "../schema/v";
import { Permit } from "../schema/wire";
import { testId } from "../testing/samples";
import { type FastOInput, fastOProblem, issueFastO } from "./fast-o";

const T0 = Date.UTC(2026, 10, 10, 12);
const sid = testId("s");
const revs = { epoch: 1, policyRev: 2, bundleRev: 3, rulesRev: 4 };
const ok: FastOInput = {
  now: T0 + 700,
  t0: T0,
  judgeDeadlineMs: 1_200,
  turnId: "turn-1",
  generation: 1,
  judge: { turnId: "turn-1", generation: 1, valid: true, verdict: "O" },
  ack: { stamp: { sessionId: sid, ...revs, generation: 1 }, issuedOpsAt: tsFromMs(T0 - 500), expiresOpsAt: tsFromMs(T0 + 2_000) },
  ackDroppedStale: false,
  deck: { ...revs, noteWaiting: false },
  outstanding: 0,
};

describe("fastOProblem", () => {
  it("is null when every condition holds", () => expect(fastOProblem(ok)).toBeNull());

  it("names each failing condition", () => {
    expect(fastOProblem({ ...ok, judge: null })).toBe("verdict");
    expect(fastOProblem({ ...ok, judge: { ...ok.judge!, verdict: "H" } })).toBe("verdict");
    expect(fastOProblem({ ...ok, judge: { ...ok.judge!, valid: false } })).toBe("verdict");
    expect(fastOProblem({ ...ok, judge: { ...ok.judge!, turnId: "turn-0" } })).toBe("verdict");
    expect(fastOProblem({ ...ok, ack: null })).toBe("ack");
    expect(fastOProblem({ ...ok, ack: null, ackDroppedStale: true })).toBe("staleAck");
    expect(fastOProblem({ ...ok, deck: { ...ok.deck, policyRev: 3 } })).toBe("ack");
    expect(fastOProblem({ ...ok, ack: { ...ok.ack!, stamp: { ...ok.ack!.stamp, generation: 2 } } })).toBe("ack");
    expect(fastOProblem({ ...ok, outstanding: 1 })).toBe("outstanding");
    expect(fastOProblem({ ...ok, deck: { ...ok.deck, noteWaiting: true } })).toBe("noteWaiting");
  });

  it("holds at ack age 2,499 and refuses at 2,500", () => {
    const issued = T0 - 500;
    expect(fastOProblem({ ...ok, now: issued + 2_499 - 0, t0: issued + 2_000 })).toBeNull();
    expect(fastOProblem({ ...ok, now: issued + 2_500, t0: issued + 2_000 })).toBe("ack");
  });

  it("holds at t0 + 1,199 and refuses at t0 + 1,200", () => {
    expect(fastOProblem({ ...ok, now: T0 + 1_199, ack: { ...ok.ack!, issuedOpsAt: tsFromMs(T0) } })).toBeNull();
    expect(fastOProblem({ ...ok, now: T0 + 1_200, ack: { ...ok.ack!, issuedOpsAt: tsFromMs(T0) } })).toBe("verdict");
  });
});

describe("issueFastO", () => {
  it("is a fastO Permit with no notes and a 10 s expiry", () => {
    const stamp = { sessionId: sid, ...revs, generation: 1, turnId: testId("t") };
    const p = issueFastO({ permitId: testId("p"), stamp, hash: "a".repeat(64), now: T0 });
    expect(p).toMatchObject({ kind: "fastO", scope: "reply", noteIds: [], momentIds: [], expiresAt: tsFromMs(T0 + 10_000), approvedPayloadHash: "a".repeat(64) });
    expect(validate(Permit, p).ok).toBe(true);
  });
});
