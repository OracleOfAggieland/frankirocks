// Feature: voice-control, Property 7: fastO needs a fresh ack (R20.1.7; R4.1–R4.4, KV13).
// Whenever the machine issues a fastO Permit: it holds a StateAck matching the Deck's four revisions, under 2.5 s
// old, delivered by a state request sent after the last /api/turn answer; no /api/turn request is outstanding; the
// judge gave a valid O for the turn; and the judge's 1,200 ms deadline has not passed.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { msFromTs } from "../schema/primitives";
import { parseJudgeDone } from "./judge";
import { arbCall, runCall } from "./testing/arb-call";
import { lastTurnAnswerAt, outstandingAt } from "./testing/trace";

const fastOId = (p: { permit: { kind: string; permitId: string } } | null | undefined) => (p?.permit.kind === "fastO" ? p.permit.permitId : null);

describe("Property 7: fastO needs a fresh ack", () => {
  it("every fastO Permit is issued with a fresh, matching ack from after the last turn answer, no outstanding turn, and a valid O in time", () => {
    fc.assert(
      fc.property(arbCall, (steps) => {
        const d = runCall(steps);
        const { steps: trace, responses } = d.trace;
        for (const s of trace) {
          const ids = [fastOId(s.after.pending), fastOId(s.after.active)].filter((x): x is string => x !== null);
          const known = [fastOId(s.before.pending), fastOId(s.before.active)];
          const issued = ids.filter((id) => !known.includes(id));
          if (issued.length === 0) continue;
          const st = s.after;
          const permit = (st.active?.permit.permitId === issued[0] ? st.active : st.pending)!.permit;
          const turnId = permit.stamp.turnId;
          // a) a fresh, matching ack
          const ack = st.ack;
          expect(ack).not.toBeNull();
          expect([ack!.stamp.epoch, ack!.stamp.policyRev, ack!.stamp.bundleRev, ack!.stamp.rulesRev]).toEqual([st.deck!.epoch, st.deck!.policyRev, st.deck!.bundleRev, st.deck!.rulesRev]);
          expect(ack!.stamp.generation).toBeLessThanOrEqual(st.session!.generation);
          expect(s.now - msFromTs(ack!.issuedOpsAt)).toBeLessThan(2_500);
          // b) delivered by a state request sent after the last /api/turn answer
          const delivery = [...trace.slice(0, s.i + 1)].reverse().find((x) => x.event.type === "stateOk" && x.event.response.ack?.issuedOpsAt === ack!.issuedOpsAt);
          expect(delivery).toBeDefined();
          const sentAt = delivery!.event.type === "stateOk" ? delivery!.event.sentAt : undefined;
          expect(sentAt).toBeDefined();
          expect(sentAt!).toBeGreaterThan(lastTurnAnswerAt(d.trace, s.i) ?? Number.NEGATIVE_INFINITY);
          // c) no outstanding /api/turn
          expect(outstandingAt(d.trace, s.i, 5_000)).toEqual([]);
          // d) a valid O from this turn's judge
          const judges = new Set(responses.filter((r) => r.purpose === "judge" && r.turnId === turnId).map((r) => r.id));
          const gotO = trace.slice(0, s.i + 1).some((x) => {
            if (x.event.type !== "realtime" || x.event.event.type !== "response.done" || !judges.has(x.event.event.response.id)) return false;
            const v = parseJudgeDone(x.event.event);
            return v.valid && v.verdict === "O";
          });
          expect(gotO).toBe(true);
          // e) within the judge's deadline
          expect(st.turn?.turnId).toBe(turnId);
          expect(s.now).toBeLessThan(st.turn!.tEnd + 1_200);
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
