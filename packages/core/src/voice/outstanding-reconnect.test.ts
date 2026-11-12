// A post sent before a reconnect is still outstanding after it: the server may still commit it, so it refuses fastO
// on the new connection until it is answered or its 5 s wait ends (Property 7 c; R4; KV13). The steps are Property
// 7's shrunk counterexample, seed 1961161853.
import { describe, expect, it } from "vitest";
import { type Step, runCall } from "./testing/arb-call";
import { outstandingAt } from "./testing/trace";

const steps = [
  { action: { k: "speechStart" }, dt: 200 },
  { action: { k: "commit" }, dt: 200 },
  { action: { k: "itemAdded", pick: 0 }, dt: 40 },
  { action: { k: "created", pick: 1 }, dt: 20 },
  { action: { k: "hash", pick: 0, ok: true }, dt: 0 },
  { action: { k: "judgeDone", pick: 0, letter: "O" }, dt: 100 },
  { action: { k: "hash", pick: 0, ok: true }, dt: 0 },
  { action: { k: "transcript", pick: 0, fail: false, empty: false }, dt: 0 },
  { action: { k: "connectionLost" }, dt: 0 },
  { action: { k: "hash", pick: 0, ok: true }, dt: 0 },
  { action: { k: "started", pick: 0 }, dt: 300 },
  { action: { k: "stopped" }, dt: 1500 },
  { action: { k: "timer", early: false, pick: 0 }, dt: 100 },
  { action: { k: "commit" }, dt: 200 },
  { action: { k: "itemAdded", pick: 0 }, dt: 40 },
  { action: { k: "created", pick: 1 }, dt: 20 },
  { action: { k: "judgeDone", pick: 0, letter: "O" }, dt: 100 },
  { action: { k: "hash", pick: 0, ok: true }, dt: 0 },
] as unknown as Step[];

const fastOId = (p: { permit: { kind: string; permitId: string } } | null | undefined) => (p?.permit.kind === "fastO" ? p.permit.permitId : null);

describe("a post from before a reconnect", () => {
  it("refuses fastO on the new connection while it is outstanding", () => {
    const d = runCall(steps);
    const issuedOver: string[][] = [];
    for (const s of d.trace.steps) {
      const before = [fastOId(s.before.pending), fastOId(s.before.active)];
      const issued = [fastOId(s.after.pending), fastOId(s.after.active)].filter((id): id is string => id !== null && !before.includes(id));
      if (issued.length === 0) continue;
      const permit = (s.after.active?.permit.permitId === issued[0] ? s.after.active : s.after.pending)!.permit;
      issuedOver.push(outstandingAt(d.trace, s.i, 5_000).filter((id) => id !== permit.stamp.turnId));
    }
    for (const other of issuedOver) expect(other).toEqual([]);
    // The new connection's Turn waits for the slow path instead.
    expect(d.trace.steps.at(-1)!.after.phase).toBe("HELD");
  });
});
