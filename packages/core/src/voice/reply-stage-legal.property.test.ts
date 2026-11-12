// Feature: voice-control, the reply's stage (brief 014, A3). `replyStage` reads where the current reply is from the
// reducer's four reply slots. Over the wide generator and arbCall, no step leaves the machine in an illegal stage,
// except the stages in ALLOWED, each named by the invariant it breaks. The allow-list is empty today and only
// shrinks, so any illegal stage fails here.
// Each generator runs two passes of 1,000 calls: a fixed-seed pass, which replays the same calls every run so the
// known shapes are caught every time, and an unseeded pass, which draws new calls every run to explore rare paths.
// fast-check prints the seed and path of any failure, so an unseeded failure reproduces from its message.
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
  it.each([
    ["fixed seed 20261111", 20261111],
    ["fresh seed", undefined],
  ] as const)("over the wide generator (%s), every step's reply stage is legal or allow-listed", (_pass, seed) => {
    fc.assert(
      fc.property(arbWideCall, (steps) => check(runWideCall(steps).trace.steps.map((s) => s.after))),
      { numRuns: 1_000, seed },
    );
  });

  it.each([
    ["fixed seed 20261112", 20261112],
    ["fresh seed", undefined],
  ] as const)("over arbCall (%s), every step's reply stage is legal or allow-listed", (_pass, seed) => {
    fc.assert(
      fc.property(arbCall, (steps) => check(runCall(steps).trace.steps.map((s) => s.after))),
      { numRuns: 1_000, seed },
    );
  });
});
