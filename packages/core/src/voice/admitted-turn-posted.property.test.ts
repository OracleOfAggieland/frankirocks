// Feature: voice-control, Property 13: An admitted turn is posted (R7.6, R7.8; docs/briefs/011-review-wave-a.md, item 7).
// Every turn whose reply was admitted is posted to /api/turn at most once as `final`, `missing` or `failed`
// (resends of the same request keep its clientSeq; a Superseding_Post is a second request and doesn't count), and,
// once every armed timer has fired, exactly once, unless the call ended first or the turn is still the machine's
// current unposted turn (it grows with the next commit, R2.6).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { activeTurn } from "./testing/trace";
import { arbCall, runCall } from "./testing/arb-call";
import { drainAll } from "./testing/trace";

const KEEP_ALIVE = ["poll", "refresh", "stateRetry", "stateRetryUi"] as const;

describe("Property 13: an admitted turn is posted", () => {
  it("every admitted turn is posted once, or the call ended, or it is still collecting audio", () => {
    fc.assert(
      fc.property(arbCall, (steps) => {
        const d = runCall(steps);
        const trace = d.trace;
        const last = trace.steps[trace.steps.length - 1];
        if (last === undefined) return;
        const drained = drainAll(last.after, last.now, KEEP_ALIVE);
        const commands = [...trace.steps.flatMap((s) => s.commands.map((c) => ({ c, i: s.i }))), ...drained.commands.map((c) => ({ c, i: Number.POSITIVE_INFINITY }))];
        const admitted = new Map<string, number>();
        for (const s of trace.steps) {
          const t = activeTurn(s.after);
          if (t !== null && !admitted.has(t)) admitted.set(t, s.i);
        }
        for (const [turnId, at] of admitted) {
          const posts = commands.filter((x) => x.c.kind === "turn" && x.c.body.turnId === turnId && x.c.supersedesTurnId === undefined);
          const seqs = new Set(posts.map((x) => (x.c.kind === "turn" ? x.c.body.clientSeq : -1)));
          expect(seqs.size, `turn ${turnId} posted under ${[...seqs].join(", ")}`).toBeLessThanOrEqual(1);
          if (seqs.size === 1) continue;
          const ended = commands.some((x) => x.c.kind === "teardown" && x.i >= at);
          const stillCurrent = drained.state.turn?.turnId === turnId && drained.state.turn.posted === null;
          expect(ended || stillCurrent, `turn ${turnId} admitted at step ${at} was never posted`).toBe(true);
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
