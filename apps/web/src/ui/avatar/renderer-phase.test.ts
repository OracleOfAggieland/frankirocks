// The renderer phase machine and the loop machine, table by table (brief 013, design note §4.1, §4.2, §5.2).
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
import type {
  EngineFailure,
  EngineStatus,
  GlSupport,
  LoopEvent,
  LoopState,
  Phase,
  RendererEvent,
  RendererState,
  RendererView,
} from "./renderer-phase";

const PHASES: readonly Phase[] = ["svg", "loading", "mounting", "building", "waiting", "fading-in", "three", "fading-out", "held", "lost", "failed"];
const GLS: readonly GlSupport[] = ["unknown", "webgl2", "none"];
const STATUSES: readonly EngineStatus[] = ["absent", "loading", "building", "ready", "lost", "failed"];
const FAILURES: readonly EngineFailure[] = ["no-webgl2", "create", "build", "merge", "shader", "frames", "aborted"];

const st = (phase: Phase, patch: Partial<RendererState> = {}): RendererState => ({
  phase,
  reduced: false,
  skipped: false,
  failure: phase === "failed" ? "build" : null,
  ...patch,
});

describe("fallbackFor: the §4.1 truth table", () => {
  /** The table's rows in order; the first row that matches decides. */
  function row(gl: GlSupport, engine: EngineStatus, reducedMotion: boolean, oneShotSkipped: boolean): "svg" | "three" {
    if (gl === "unknown") return "svg";
    if (gl === "none") return "svg";
    if (engine === "absent" || engine === "loading" || engine === "building") return "svg";
    if (engine === "failed") return "svg";
    if (engine === "lost") return "svg";
    if (reducedMotion) return "svg";
    if (oneShotSkipped) return "svg";
    return "three";
  }

  for (const gl of GLS) {
    for (const engine of STATUSES) {
      for (const reducedMotion of [false, true]) {
        for (const oneShotSkipped of [false, true]) {
          const expected = row(gl, engine, reducedMotion, oneShotSkipped);
          it(`${gl} ${engine} reduced ${reducedMotion} skipped ${oneShotSkipped}: ${expected}`, () => {
            expect(fallbackFor({ gl, engine, reducedMotion, oneShotSkipped })).toBe(expected);
          });
        }
      }
    }
  }

  it("has exactly one row that shows three.js", () => {
    const threes = GLS.flatMap((gl) =>
      STATUSES.flatMap((engine) =>
        [false, true].flatMap((reducedMotion) =>
          [false, true].filter((oneShotSkipped) => fallbackFor({ gl, engine, reducedMotion, oneShotSkipped }) === "three"),
        ),
      ),
    );
    expect(threes).toHaveLength(1);
    expect(fallbackFor({ gl: "webgl2", engine: "ready", reducedMotion: false, oneShotSkipped: false })).toBe("three");
  });
});

describe("statusOf", () => {
  const EXPECTED: Record<Exclude<Phase, "failed">, { gl: GlSupport; engine: EngineStatus }> = {
    svg: { gl: "unknown", engine: "absent" },
    loading: { gl: "webgl2", engine: "loading" },
    mounting: { gl: "webgl2", engine: "loading" },
    building: { gl: "webgl2", engine: "building" },
    waiting: { gl: "webgl2", engine: "ready" },
    "fading-in": { gl: "webgl2", engine: "ready" },
    three: { gl: "webgl2", engine: "ready" },
    "fading-out": { gl: "webgl2", engine: "ready" },
    held: { gl: "webgl2", engine: "ready" },
    lost: { gl: "webgl2", engine: "lost" },
  };
  for (const [phase, status] of Object.entries(EXPECTED) as [Phase, { gl: GlSupport; engine: EngineStatus }][]) {
    it(`${phase} reads ${status.gl}/${status.engine}`, () => {
      for (const reduced of [false, true]) for (const skipped of [false, true]) expect(statusOf(st(phase, { reduced, skipped }))).toEqual(status);
    });
  }
  for (const failure of FAILURES) {
    const expected = failure === "no-webgl2" ? { gl: "none", engine: "failed" } : { gl: "webgl2", engine: "failed" };
    it(`failed (${failure}) reads ${expected.gl}/${expected.engine}`, () => {
      expect(statusOf(st("failed", { failure }))).toEqual(expected);
    });
  }
});

describe("rendererStep: the §4.2 transition table", () => {
  type Row = [from: RendererState, event: RendererEvent, to: RendererState];
  const ROWS: [string, Row][] = [
    ["svg, probed(true), not reduced: loading", [st("svg"), { kind: "probed", ok: true }, st("loading")]],
    ["svg, probed(true), reduced: stays svg", [st("svg", { reduced: true }), { kind: "probed", ok: true }, st("svg", { reduced: true })]],
    ["svg, probed(false): failed no-webgl2", [st("svg"), { kind: "probed", ok: false }, st("failed", { failure: "no-webgl2" })]],
    ["svg, probed(false), reduced: failed no-webgl2", [st("svg", { reduced: true }), { kind: "probed", ok: false }, st("failed", { reduced: true, failure: "no-webgl2" })]],
    ["loading, loaded: mounting", [st("loading"), { kind: "loaded" }, st("mounting")]],
    ["mounting, sized: building", [st("mounting"), { kind: "sized" }, st("building")]],
    ["building, ready: fading-in", [st("building"), { kind: "ready" }, st("fading-in")]],
    ["building, ready, reduced: held", [st("building", { reduced: true }), { kind: "ready" }, st("held", { reduced: true })]],
    ["building, ready, skipped: waiting", [st("building", { skipped: true }), { kind: "ready" }, st("waiting", { skipped: true })]],
    ["building, ready, reduced and skipped: held", [st("building", { reduced: true, skipped: true }), { kind: "ready" }, st("held", { reduced: true, skipped: true })]],
    ["building, lost: ignored", [st("building"), { kind: "lost" }, st("building")]],
    ["waiting, one-shot(false): fading-in", [st("waiting", { skipped: true }), { kind: "one-shot", skipped: false }, st("fading-in")]],
    ["waiting, one-shot(true): stays waiting", [st("waiting", { skipped: true }), { kind: "one-shot", skipped: true }, st("waiting", { skipped: true })]],
    ["waiting, reduced(true): held", [st("waiting", { skipped: true }), { kind: "reduced", value: true }, st("held", { reduced: true, skipped: true })]],
    ["fading-in, fade-done: three", [st("fading-in"), { kind: "fade-done" }, st("three")]],
    ["fading-in, reduced(true): held (a cut)", [st("fading-in"), { kind: "reduced", value: true }, st("held", { reduced: true })]],
    ["three, reduced(true): fading-out", [st("three"), { kind: "reduced", value: true }, st("fading-out", { reduced: true })]],
    ["fading-out, fade-done, reduced: held", [st("fading-out", { reduced: true }), { kind: "fade-done" }, st("held", { reduced: true })]],
    ["fading-out, fade-done, not reduced: fading-in", [st("fading-out"), { kind: "fade-done" }, st("fading-in")]],
    ["held, reduced(false): fading-in", [st("held", { reduced: true }), { kind: "reduced", value: false }, st("fading-in")]],
    ["held, reduced(false), skipped: waiting", [st("held", { reduced: true, skipped: true }), { kind: "reduced", value: false }, st("waiting", { skipped: true })]],
    ["lost, restored: fading-in", [st("lost"), { kind: "restored" }, st("fading-in")]],
    ["lost, restored, reduced: held", [st("lost", { reduced: true }), { kind: "restored" }, st("held", { reduced: true })]],
    ["lost, restored, skipped: waiting", [st("lost", { skipped: true }), { kind: "restored" }, st("waiting", { skipped: true })]],
  ];
  for (const from of ["waiting", "fading-in", "three", "fading-out", "held"] as const) {
    ROWS.push([`${from}, lost: lost`, [st(from), { kind: "lost" }, st("lost")]]);
  }
  for (const from of ["loading", "mounting", "building", "waiting", "fading-in", "three", "fading-out", "held", "lost"] as const) {
    for (const reason of ["create", "shader", "frames"] as const) {
      ROWS.push([`${from}, failed(${reason}): failed`, [st(from), { kind: "failed", reason }, st("failed", { failure: reason })]]);
    }
  }
  for (const phase of PHASES) {
    for (const reduced of [false, true]) {
      ROWS.push([
        `${phase} (reduced ${reduced}), stopped: svg`,
        [st(phase, { reduced, skipped: true, failure: phase === "failed" ? "shader" : null }), { kind: "stopped" }, { phase: "svg", reduced, skipped: false, failure: null }],
      ]);
    }
  }

  for (const [name, [from, event, to]] of ROWS) {
    it(name, () => {
      const copy = structuredClone(from);
      expect(rendererStep(from, event)).toEqual(to);
      expect(from).toEqual(copy);
    });
  }

  it("failed is absorbing until stopped: every other event keeps the phase and the first failure", () => {
    const events: RendererEvent[] = [
      { kind: "probed", ok: true },
      { kind: "probed", ok: false },
      { kind: "loaded" },
      { kind: "sized" },
      { kind: "ready" },
      { kind: "failed", reason: "frames" },
      { kind: "fade-done" },
      { kind: "lost" },
      { kind: "restored" },
      { kind: "reduced", value: false },
      { kind: "one-shot", skipped: false },
    ];
    for (const e of events) {
      const out = rendererStep(st("failed", { failure: "shader" }), e);
      expect(out.phase).toBe("failed");
      expect(out.failure).toBe("shader");
    }
  });

  it("an event not in the table only records reduced or skipped", () => {
    expect(rendererStep(st("loading"), { kind: "reduced", value: true })).toEqual(st("loading", { reduced: true }));
    expect(rendererStep(st("building"), { kind: "one-shot", skipped: true })).toEqual(st("building", { skipped: true }));
    expect(rendererStep(st("lost"), { kind: "one-shot", skipped: true })).toEqual(st("lost", { skipped: true }));
    expect(rendererStep(st("held", { reduced: true }), { kind: "one-shot", skipped: true })).toEqual(st("held", { reduced: true, skipped: true }));
    expect(rendererStep(st("three"), { kind: "reduced", value: false })).toEqual(st("three"));
    expect(rendererStep(st("svg"), { kind: "ready" })).toEqual(st("svg"));
    expect(rendererStep(st("svg"), { kind: "failed", reason: "build" })).toEqual(st("svg"));
    expect(rendererStep(st("three"), { kind: "probed", ok: false })).toEqual(st("three"));
    expect(rendererStep(st("three"), { kind: "restored" })).toEqual(st("three"));
    expect(rendererStep(st("mounting"), { kind: "lost" })).toEqual(st("mounting"));
  });

  it("where the engine sees one-shots start, a one-shot is never recorded as skipped", () => {
    for (const phase of ["fading-in", "three", "fading-out"] as const) {
      expect(rendererStep(st(phase), { kind: "one-shot", skipped: true })).toEqual(st(phase));
    }
  });

  it("the first mount walks svg, loading, mounting, building, fading-in, three", () => {
    const events: RendererEvent[] = [
      { kind: "reduced", value: false },
      { kind: "probed", ok: true },
      { kind: "loaded" },
      { kind: "sized" },
      { kind: "ready" },
      { kind: "fade-done" },
    ];
    const phases: Phase[] = [];
    let s: RendererState = INITIAL_RENDERER;
    for (const e of events) {
      s = rendererStep(s, e);
      phases.push(s.phase);
    }
    expect(phases).toEqual(["svg", "loading", "mounting", "building", "fading-in", "three"]);
  });
});

describe("seesOneShots", () => {
  for (const phase of PHASES) {
    const expected = phase === "waiting" || phase === "fading-in" || phase === "three" || phase === "fading-out";
    it(`${phase}: ${expected}`, () => {
      expect(seesOneShots(st(phase))).toBe(expected);
      expect(seesOneShots(st(phase, { reduced: true, skipped: true }))).toBe(expected);
    });
  }
});

describe("rendererView: the §4.2 view table", () => {
  const VIEWS: Record<Phase, RendererView> = {
    svg: { svg: "absent", canvas: "absent", engine: "probe", loop: "none" },
    loading: { svg: "absent", canvas: "absent", engine: "load", loop: "none" },
    mounting: { svg: "absent", canvas: "hidden", engine: "await-size", loop: "none" },
    building: { svg: "absent", canvas: "hidden", engine: "build", loop: "not-yet" },
    waiting: { svg: "absent", canvas: "hidden", engine: "keep", loop: "runs" },
    "fading-in": { svg: "absent", canvas: "entering", engine: "keep", loop: "runs" },
    three: { svg: "absent", canvas: "shown", engine: "keep", loop: "runs" },
    "fading-out": { svg: "entering", canvas: "shown", engine: "keep", loop: "runs" },
    held: { svg: "shown", canvas: "hidden", engine: "keep", loop: "held" },
    lost: { svg: "shown", canvas: "hidden", engine: "keep", loop: "stopped" },
    failed: { svg: "shown", canvas: "absent", engine: "dispose", loop: "none" },
  };
  for (const phase of PHASES) {
    it(phase, () => {
      expect(rendererView(st(phase))).toEqual(VIEWS[phase]);
    });
  }
  it("svg probes only while reduced motion is off, and fades the SVG ghost in only while it is on", () => {
    expect(rendererView(st("svg", { reduced: true })).engine).toBe("none");
    expect(rendererView(INITIAL_RENDERER)).toEqual({ svg: "entering", canvas: "absent", engine: "none", loop: "none" });
  });
  it("every other phase ignores reduced and skipped", () => {
    for (const phase of PHASES.filter((p) => p !== "svg")) {
      expect(rendererView(st(phase, { reduced: true, skipped: true }))).toEqual(VIEWS[phase]);
    }
  });
});

describe("the initial states", () => {
  it("the renderer starts as svg, reduced, nothing skipped, no failure", () => {
    expect(INITIAL_RENDERER).toEqual({ phase: "svg", reduced: true, skipped: false, failure: null });
    expect(fallbackFor({ ...statusOf(INITIAL_RENDERER), reducedMotion: INITIAL_RENDERER.reduced, oneShotSkipped: INITIAL_RENDERER.skipped })).toBe("svg");
  });
  it("the loop starts building and held, visible, gl ok, no errors, and does not run", () => {
    expect(INITIAL_LOOP).toEqual({ life: "building", hold: "hold", page: "visible", gl: "ok", errors: 0 });
    expect(loopRuns(INITIAL_LOOP)).toBe(false);
  });
});

describe("loopStep", () => {
  const live: LoopState = { life: "live", hold: "run", page: "visible", gl: "ok", errors: 0 };
  type Row = [from: LoopState, event: LoopEvent, to: LoopState];
  const ROWS: [string, Row][] = [
    ["built: building to live", [INITIAL_LOOP, "built", { ...INITIAL_LOOP, life: "live" }]],
    ["built while live stays live", [live, "built", live]],
    ["built while failed stays failed", [{ ...live, life: "failed" }, "built", { ...live, life: "failed" }]],
    ["hold", [live, "hold", { ...live, hold: "hold" }]],
    ["run", [{ ...live, hold: "hold" }, "run", live]],
    ["hide", [live, "hide", { ...live, page: "hidden" }]],
    ["show", [{ ...live, page: "hidden" }, "show", live]],
    ["lost", [live, "lost", { ...live, gl: "lost" }]],
    ["restored", [{ ...live, gl: "lost" }, "restored", live]],
    ["frame-error counts", [live, "frame-error", { ...live, errors: 1 }]],
    ["frame-error under the limit keeps life", [{ ...live, errors: FRAME_ERROR_LIMIT - 2 }, "frame-error", { ...live, errors: FRAME_ERROR_LIMIT - 1 }]],
    ["frame-error reaching the limit fails", [{ ...live, errors: FRAME_ERROR_LIMIT - 1 }, "frame-error", { ...live, errors: FRAME_ERROR_LIMIT, life: "failed" }]],
    ["frame-error while building, reaching the limit, fails", [{ ...INITIAL_LOOP, errors: FRAME_ERROR_LIMIT - 1 }, "frame-error", { ...INITIAL_LOOP, errors: FRAME_ERROR_LIMIT, life: "failed" }]],
    ["frame-error past the limit stays at the limit", [{ ...live, life: "failed", errors: FRAME_ERROR_LIMIT }, "frame-error", { ...live, life: "failed", errors: FRAME_ERROR_LIMIT }]],
    ["frame-ok resets errors", [{ ...live, errors: 7 }, "frame-ok", live]],
    ["frame-ok does not revive a failed engine", [{ ...live, life: "failed", errors: FRAME_ERROR_LIMIT }, "frame-ok", { ...live, life: "failed" }]],
    ["dispose", [live, "dispose", { ...live, life: "disposed" }]],
    ["dispose while building", [INITIAL_LOOP, "dispose", { ...INITIAL_LOOP, life: "disposed" }]],
  ];
  for (const [name, [from, event, to]] of ROWS) {
    it(name, () => {
      const copy = { ...from };
      expect(loopStep(from, event)).toEqual(to);
      expect(from).toEqual(copy);
    });
  }

  it("dispose is absorbing", () => {
    const events: LoopEvent[] = ["built", "hold", "run", "hide", "show", "lost", "restored", "frame-error", "frame-ok", "dispose"];
    const gone: LoopState = { life: "disposed", hold: "hold", page: "hidden", gl: "lost", errors: 3 };
    for (const e of events) expect(loopStep(gone, e)).toEqual(gone);
  });

  it(`${FRAME_ERROR_LIMIT} frame errors in a row fail a live engine; one good frame in between resets the count`, () => {
    let s = live;
    for (let i = 0; i < FRAME_ERROR_LIMIT - 1; i++) s = loopStep(s, "frame-error");
    expect(s.life).toBe("live");
    s = loopStep(s, "frame-ok");
    for (let i = 0; i < FRAME_ERROR_LIMIT - 1; i++) s = loopStep(s, "frame-error");
    expect(s.life).toBe("live");
    expect(loopRuns(s)).toBe(true);
    s = loopStep(s, "frame-error");
    expect(s.life).toBe("failed");
    expect(loopRuns(s)).toBe(false);
  });
});

describe("loopRuns", () => {
  for (const life of ["building", "live", "failed", "disposed"] as const) {
    for (const hold of ["run", "hold"] as const) {
      for (const page of ["visible", "hidden"] as const) {
        for (const gl of ["ok", "lost"] as const) {
          const expected = life === "live" && hold === "run" && page === "visible" && gl === "ok";
          it(`${life} ${hold} ${page} ${gl}: ${expected}`, () => {
            expect(loopRuns({ life, hold, page, gl, errors: 0 })).toBe(expected);
            expect(loopRuns({ life, hold, page, gl, errors: 5 })).toBe(expected);
          });
        }
      }
    }
  }
});
