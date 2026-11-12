// Feature: voice-control, Property 12: A late Permit plays; a timed-out request doesn't (R20.1.12; R7.5, R18.7).
// (a) Once the permit wait of a held turn has fired, nothing more is created for that turn.
// (b) A server Permit for the held turn that arrives while its request is younger than 5 s, current and unexpired,
//     is sent for checking at once, however long after the commit it arrives.
// (c) A latency row is late exactly when its Permit arrived after commit + 2,500 ms.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { msFromTs } from "../schema/primitives";
import { localStamp, sameStamp } from "./machine";
import { arbCall, runCall } from "./testing/arb-call";
import { postsOf } from "./testing/trace";

const meta = (e: Record<string, unknown>) => ((e.response as Record<string, unknown> | undefined)?.metadata as Record<string, string> | undefined) ?? {};

describe("Property 12: a late Permit plays; a timed-out request doesn't", () => {
  it("permit wait, late answers and the late flag", () => {
    fc.assert(
      fc.property(arbCall, (steps) => {
        const d = runCall(steps);
        const { steps: trace, creates } = d.trace;
        for (const s of trace) {
          const b = s.before;
          // (a)
          if (s.event.type === "timer" && s.event.name === "permit" && b.deadlines.permit !== undefined && s.now >= b.deadlines.permit && b.phase === "HELD" && b.active === null && b.turn !== null) {
            const t = b.turn.turnId;
            expect(creates.filter((c) => c.step > s.i && meta(c.event).turnId === t)).toEqual([]);
          }
          // (b)
          if (s.event.type === "turnOk" && b.phase === "HELD" && b.active === null && b.turn?.turnId === s.event.turnId && b.admittedTurnId !== s.event.turnId) {
            const res = s.event.response;
            const p = res.permit;
            if (p === null || res.error !== null || (p.kind !== "slowOrdinary" && p.kind !== "postCommitControl") || (res.status !== "ordinary" && res.status !== "ready")) continue;
            const stamp = localStamp(b);
            const deckSame = res.deck === null || (b.deck !== null && res.deck.epoch === b.deck.epoch && res.deck.policyRev === b.deck.policyRev && res.deck.bundleRev === b.deck.bundleRev && res.deck.rulesRev === b.deck.rulesRev);
            const post = postsOf(d.trace, s.event.turnId).filter((x) => x.i < s.i).at(-1);
            if (stamp === null || !sameStamp(p.stamp, stamp) || !deckSame || msFromTs(p.expiresAt) <= s.now || post === undefined || s.now - post.now >= 5_000) continue;
            expect(s.commands.some((c) => c.kind === "verifyPermit" && c.permitId === p.permitId)).toBe(true);
          }
        }
        // (c)
        for (const r of d.st.latency.rows) if (r.permitAt !== null && r.commit !== null) expect(r.late).toBe(r.permitAt > r.commit + 2_500);
      }),
      { numRuns: 1_000 },
    );
  });
});
