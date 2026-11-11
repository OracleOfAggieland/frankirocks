// Feature: voice-control, the reply's stage (brief 014, A3). `replyStage` reads where the current reply is from the
// reducer's four reply slots. Over the wide generator and arbCall, no step leaves the machine in an illegal stage,
// except the stages in ALLOWED, each named by the invariant it breaks. The allow-list is empty today and only
// shrinks, so any illegal stage fails here.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbCall, runCall } from "./testing/arb-call";
import { arbWideCall, runWideCall } from "./testing/arb-call-wide";
import { type IllegalReplyStage, isIllegalReplyStage, replyStage } from "./testing/reply-stage";

/** Illegal stages the machine produces today, by the invariant each breaks. None. */
const ALLOWED: Partial<Record<IllegalReplyStage, string>> = {};

const check = (states: Iterable<Parameters<typeof replyStage>[0]>) => {
  for (const st of states) {
    const s = replyStage(st);
    if (isIllegalReplyStage(s)) expect(ALLOWED[s], `illegal reply stage ${s} in ${st.phase}`).toBeDefined();
  }
};

describe("the voice reply is only ever at a legal stage", () => {
  it("over the wide generator, every step's reply stage is legal or allow-listed", () => {
    fc.assert(
      fc.property(arbWideCall, (steps) => check(runWideCall(steps).trace.steps.map((s) => s.after))),
      { numRuns: 1_000 },
    );
  });

  it("over arbCall, every step's reply stage is legal or allow-listed", () => {
    fc.assert(
      fc.property(arbCall, (steps) => check(runCall(steps).trace.steps.map((s) => s.after))),
      { numRuns: 1_000 },
    );
  });
});
