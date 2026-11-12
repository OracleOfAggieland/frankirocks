// Property tests for the renderer phase machine and the loop machine (brief 013, design note §4, §5.2, §8.1).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  fallbackFor,
  FRAME_ERROR_LIMIT,
  INITIAL_LOOP,
  INITIAL_RENDERER,
  loopRuns,
  loopStep,
  rendererStep,
  rendererView,
  seesOneShots,
  statusOf,
} from "./renderer-phase";
import type { EngineFailure, LoopEvent, LoopState, Phase, RendererEvent, RendererState } from "./renderer-phase";

const PHASES: readonly Phase[] = ["svg", "loading", "mounting", "building", "waiting", "fading-in", "three", "fading-out", "held", "lost", "failed"];
const FAILURES: readonly EngineFailure[] = ["no-webgl2", "create", "build", "merge", "shader", "frames", "aborted"];

const arbFailure = fc.constantFrom(...FAILURES);
const arbEvent: fc.Arbitrary<RendererEvent> = fc.oneof(
  fc.boolean().map((value) => ({ kind: "reduced" as const, value })),
  fc.boolean().map((ok) => ({ kind: "probed" as const, ok })),
  fc.constant({ kind: "loaded" as const }),
  fc.constant({ kind: "sized" as const }),
  fc.constant({ kind: "ready" as const }),
  arbFailure.map((reason) => ({ kind: "failed" as const, reason })),
  fc.constant({ kind: "fade-done" as const }),
  fc.constant({ kind: "lost" as const }),
  fc.constant({ kind: "restored" as const }),
  fc.boolean().map((skipped) => ({ kind: "one-shot" as const, skipped })),
  fc.constant({ kind: "stopped" as const }),
);

/** The mount's own events, weighted so walks reach the ready phases often; failures and stops stay rare. */
const arbLikelyEvent: fc.Arbitrary<RendererEvent> = fc.oneof(
  { arbitrary: fc.boolean().map((value) => ({ kind: "reduced" as const, value })), weight: 3 },
  { arbitrary: fc.constant({ kind: "probed" as const, ok: true }), weight: 3 },
  { arbitrary: fc.constant({ kind: "loaded" as const }), weight: 3 },
  { arbitrary: fc.constant({ kind: "sized" as const }), weight: 3 },
  { arbitrary: fc.constant({ kind: "ready" as const }), weight: 3 },
  { arbitrary: fc.constant({ kind: "fade-done" as const }), weight: 3 },
  { arbitrary: fc.boolean().map((skipped) => ({ kind: "one-shot" as const, skipped })), weight: 3 },
  { arbitrary: fc.constant({ kind: "lost" as const }), weight: 1 },
  { arbitrary: fc.constant({ kind: "restored" as const }), weight: 2 },
  { arbitrary: arbEvent, weight: 1 },
);

/** Any state at all, reachable or not. */
const arbAnyState: fc.Arbitrary<RendererState> = fc.record({
  phase: fc.constantFrom(...PHASES),
  reduced: fc.boolean(),
  skipped: fc.boolean(),
  failure: fc.option(arbFailure, { nil: null }),
});

const arbWalk = fc.array(arbLikelyEvent, { maxLength: 60 });

function walk(events: readonly RendererEvent[], from: RendererState = INITIAL_RENDERER): RendererState[] {
  const out: RendererState[] = [];
  let s = from;
  for (const e of events) {
    s = rendererStep(s, e);
    out.push(s);
  }
  return out;
}

function isValid(s: RendererState): boolean {
  return (
    Object.keys(s).sort().join() === "failure,phase,reduced,skipped" &&
    PHASES.includes(s.phase) &&
    typeof s.reduced === "boolean" &&
    typeof s.skipped === "boolean" &&
    (s.failure === null || FAILURES.includes(s.failure))
  );
}

const shows = (s: RendererState) => fallbackFor({ ...statusOf(s), reducedMotion: s.reduced, oneShotSkipped: s.skipped });

describe("rendererStep", () => {
  it("every event from every state gives a valid state, deterministically, without mutating the input", () => {
    fc.assert(
      fc.property(arbAnyState, arbEvent, (s, e) => {
        const copy = structuredClone(s);
        const out = rendererStep(s, e);
        expect(isValid(out)).toBe(true);
        expect(s).toEqual(copy);
        expect(rendererStep(copy, e)).toEqual(out);
      }),
      { numRuns: 1000 },
    );
  });

  it("on every walk from the start, a failure is recorded exactly in failed", () => {
    fc.assert(
      fc.property(arbWalk, (events) => {
        for (const s of walk(events)) expect(s.failure !== null).toBe(s.phase === "failed");
      }),
      { numRuns: 500 },
    );
  });

  it("a three phase implies the truth table says three", () => {
    fc.assert(
      fc.property(arbWalk, (events) => {
        for (const s of walk(events)) if (s.phase === "three") expect(shows(s)).toBe("three");
      }),
      { numRuns: 500 },
    );
  });

  it("the canvas fades in only where the truth table says three", () => {
    fc.assert(
      fc.property(arbWalk, (events) => {
        for (const s of walk(events)) if (s.phase === "fading-in") expect(shows(s)).toBe("three");
      }),
      { numRuns: 500 },
    );
  });

  it("reduced motion never shows three", () => {
    fc.assert(
      fc.property(arbWalk, (events) => {
        for (const s of walk(events)) {
          if (s.reduced) {
            expect(s.phase).not.toBe("three");
            expect(s.phase).not.toBe("fading-in");
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it("skipped is false in fading-in, three and fading-out", () => {
    fc.assert(
      fc.property(arbWalk, (events) => {
        for (const s of walk(events)) {
          if (s.phase === "fading-in" || s.phase === "three" || s.phase === "fading-out") expect(s.skipped).toBe(false);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("failed is absorbing until stopped", () => {
    fc.assert(
      fc.property(arbAnyState, arbFailure, fc.array(arbEvent, { maxLength: 30 }), (s, failure, events) => {
        let cur: RendererState = { ...s, phase: "failed", failure };
        for (const e of events) {
          const next = rendererStep(cur, e);
          if (e.kind === "stopped") {
            expect(next.phase).toBe("svg");
            break;
          }
          expect(next.phase).toBe("failed");
          expect(next.failure).toBe(failure);
          cur = next;
        }
      }),
      { numRuns: 500 },
    );
  });

  it("stopped from any phase equals a fresh state with the same reduced", () => {
    fc.assert(
      fc.property(arbAnyState, (s) => {
        expect(rendererStep(s, { kind: "stopped" })).toEqual({ ...INITIAL_RENDERER, reduced: s.reduced });
      }),
    );
  });

  it("stopped then a replay of the same events from a fresh state with the same reduced ends the same", () => {
    fc.assert(
      fc.property(arbWalk, arbWalk, (before, after) => {
        const left = walk([...before, { kind: "stopped" }, ...after]).at(-1) ?? INITIAL_RENDERER;
        const stopped = walk([...before, { kind: "stopped" }]).at(-1) ?? INITIAL_RENDERER;
        const right = walk(after, { ...INITIAL_RENDERER, reduced: stopped.reduced }).at(-1) ?? { ...INITIAL_RENDERER, reduced: stopped.reduced };
        expect(left).toEqual(right);
      }),
      { numRuns: 300 },
    );
  });

  it("lost shows the SVG at once, with the canvas hidden and the loop stopped", () => {
    fc.assert(
      fc.property(arbWalk, (events) => {
        let prev: RendererState = INITIAL_RENDERER;
        for (const e of events) {
          const s = rendererStep(prev, e);
          if (e.kind === "lost" && seesOneShots(prev)) expect(s.phase).toBe("lost");
          if (s.phase === "lost") expect(rendererView(s)).toEqual({ svg: "shown", canvas: "hidden", engine: "keep", loop: "stopped" });
          prev = s;
        }
      }),
      { numRuns: 500 },
    );
  });

  it("no canvas entering or shown before ready", () => {
    fc.assert(
      fc.property(arbWalk, (events) => {
        let prev: RendererState = INITIAL_RENDERER;
        let ready = false;
        for (const e of events) {
          const s = rendererStep(prev, e);
          if (e.kind === "ready" && prev.phase === "building") ready = true;
          if (e.kind === "stopped") ready = false;
          const { canvas } = rendererView(s);
          if (!ready) expect(canvas === "entering" || canvas === "shown").toBe(false);
          prev = s;
        }
      }),
      { numRuns: 500 },
    );
  });

  it("the SVG layer shows only as the fallback: never before the canvas has shown, unless motion is reduced", () => {
    fc.assert(
      fc.property(arbAnyState, (s) => {
        const v = rendererView(s);
        const fallback = s.phase === "fading-out" || s.phase === "held" || s.phase === "lost" || s.phase === "failed";
        expect(v.svg !== "absent").toBe(fallback || (s.phase === "svg" && s.reduced));
        // The two layers never fade at once.
        if (v.canvas === "entering") expect(v.svg).toBe("absent");
      }),
    );
  });

  it("the engine is built only in building, and only after a sized mounting", () => {
    fc.assert(
      fc.property(arbWalk, (events) => {
        let prev: RendererState = INITIAL_RENDERER;
        for (const e of events) {
          const s = rendererStep(prev, e);
          if (s.phase === "building" && prev.phase !== "building") {
            expect(prev.phase).toBe("mounting");
            expect(e.kind).toBe("sized");
          }
          prev = s;
        }
      }),
      { numRuns: 500 },
    );
  });
});

const arbLoopEvent: fc.Arbitrary<LoopEvent> = fc.constantFrom("built", "hold", "run", "hide", "show", "lost", "restored", "frame-error", "frame-ok", "dispose");
const arbLoopState: fc.Arbitrary<LoopState> = fc.record({
  life: fc.constantFrom("building", "live", "failed", "disposed"),
  hold: fc.constantFrom("run", "hold"),
  page: fc.constantFrom("visible", "hidden"),
  gl: fc.constantFrom("ok", "lost"),
  errors: fc.integer({ min: 0, max: FRAME_ERROR_LIMIT }),
});

describe("loopStep", () => {
  it("is total: any event from any state gives a valid state, without mutating the input", () => {
    fc.assert(
      fc.property(arbLoopState, arbLoopEvent, (s, e) => {
        const copy = { ...s };
        const out = loopStep(s, e);
        expect(s).toEqual(copy);
        expect(Object.keys(out).sort().join()).toBe("errors,gl,hold,life,page");
        expect(["building", "live", "failed", "disposed"]).toContain(out.life);
        expect(["run", "hold"]).toContain(out.hold);
        expect(["visible", "hidden"]).toContain(out.page);
        expect(["ok", "lost"]).toContain(out.gl);
        expect(Number.isInteger(out.errors) && out.errors >= 0 && out.errors <= FRAME_ERROR_LIMIT).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("dispose is absorbing", () => {
    fc.assert(
      fc.property(arbLoopState, fc.array(arbLoopEvent, { maxLength: 30 }), (s, events) => {
        let cur = loopStep(s, "dispose");
        const gone = { ...cur };
        for (const e of events) cur = loopStep(cur, e);
        expect(cur).toEqual(gone);
        expect(loopRuns(cur)).toBe(false);
      }),
    );
  });

  it(`${FRAME_ERROR_LIMIT} consecutive frame errors fail the engine, whatever else happens between them`, () => {
    const notOkOrDispose = fc.constantFrom<LoopEvent>("built", "hold", "run", "hide", "show", "lost", "restored");
    fc.assert(
      fc.property(
        arbLoopState.filter((s) => s.life !== "disposed"),
        fc.array(fc.array(notOkOrDispose, { maxLength: 3 }), { minLength: FRAME_ERROR_LIMIT, maxLength: FRAME_ERROR_LIMIT }),
        (s, gaps) => {
          let cur = loopStep(s, "frame-ok");
          for (const gap of gaps) {
            for (const e of gap) cur = loopStep(cur, e);
            cur = loopStep(cur, "frame-error");
          }
          expect(cur.life).toBe("failed");
          expect(loopRuns(cur)).toBe(false);
        },
      ),
    );
  });

  it("fewer than the limit since the last good frame never fails a live engine", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom<LoopEvent>("frame-error", "frame-ok", "hold", "run", "hide", "show", "lost", "restored"), { maxLength: 120 }), (events) => {
        let cur: LoopState = loopStep({ ...INITIAL_LOOP }, "built");
        let run = 0;
        for (const e of events) {
          cur = loopStep(cur, e);
          if (e === "frame-error") run++;
          if (e === "frame-ok") run = 0;
          expect(cur.life === "failed").toBe(run >= FRAME_ERROR_LIMIT);
          if (cur.life === "failed") break;
        }
      }),
      { numRuns: 500 },
    );
  });

  it("loopRuns is exactly life live, hold run, page visible and gl ok", () => {
    fc.assert(
      fc.property(arbLoopState, (s) => {
        expect(loopRuns(s)).toBe(s.life === "live" && s.hold === "run" && s.page === "visible" && s.gl === "ok");
      }),
    );
  });

  it("the four facts are independent: an event changes at most the fact it names (and life on the limit)", () => {
    fc.assert(
      fc.property(arbLoopState.filter((s) => s.life !== "disposed"), arbLoopEvent, (s, e) => {
        const out = loopStep(s, e);
        if (e !== "hold" && e !== "run") expect(out.hold).toBe(s.hold);
        if (e !== "hide" && e !== "show") expect(out.page).toBe(s.page);
        if (e !== "lost" && e !== "restored") expect(out.gl).toBe(s.gl);
        if (e !== "frame-error" && e !== "frame-ok") expect(out.errors).toBe(s.errors);
        if (e !== "built" && e !== "frame-error" && e !== "dispose") expect(out.life).toBe(s.life);
      }),
      { numRuns: 1000 },
    );
  });
});
