"use client";
// The three.js ghost on the Specimens_Page (brief 013 rule 9; design note §8.2 items 1 and 2, WP14). Every Look_Name
// with Reduced_Motion off, Ghost_Mode over Listening and Speaking, and one pair with Reduced_Motion on that shows the
// fallback: each a pair, the SVG ghost beside the three.js ghost, at the 144 px tile size. Speaking and Listening
// read the simulated voices (_sim/speech-synth.ts, director decision D-2); Waking and Celebrate cycle (a state look,
// the one-shot, a state look) so each edge happens while the engine runs. Each tile has its own renderer, its own
// Electricity budget of 1 and its own speech source, and mounts its engine only while it is on screen, so at most
// the visible tiles, the main-screen specimens and the parity panel hold a WebGL context. Below the tiles, the still
// parity panel builds one engine at a time with still: true in a fixed 1280 x 900 box, for a pixel comparison with
// the prototype at ?still=1&state=<name> in a window of the same size.
//
// Nothing here value-imports components/avatar/three/: the engine arrives only through browserThreeHost().loadEngine().
import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { Avatar } from "../../../components/avatar/Avatar";
import { AvatarAudioContext } from "../../../components/avatar/avatar-audio";
import { Stage } from "../../../components/avatar/Stage";
import { SvgGhost } from "../../../components/avatar/SvgGhost";
import { createThreeGhost } from "../../../components/avatar/ThreeGhost";
import { browserThreeHost } from "../../../components/avatar/three-host";
import type { AvatarEngine, EngineEvent, EngineOptions, EngineStats, EngineTimings, Size } from "../../../components/avatar/three/engine";
import { QUIET_BUTTON } from "../../../components/surfaces/classes";
import type { Acting } from "../../../ui/avatar/acting";
import { lookFor } from "../../../ui/avatar/look";
import type { AvatarInput } from "../../../ui/avatar/types";
import { createElectricityBudget } from "../../../ui/electricity-budget";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import { EVENT_MS } from "../../../ui/motion";
import { avatarInput } from "../_fixtures";
import { createSpeechSource } from "../_sim/speech-synth";
import { Section, Tile } from "./Section";

/* ---------------------------------------------------------------------
   The cycling one-shots: a closed phase union with one pure step.
   --------------------------------------------------------------------- */

type CycleKind = "wake" | "celebrate";
/** `before` and `after` are state looks; `shot` is the one-shot's look, held for the event's own length. */
type CyclePhase = "before" | "shot" | "after";

/** How long each state look holds before the next edge. */
const REST_MS = 2400;

function cycleNext(p: CyclePhase): CyclePhase {
  switch (p) {
    case "before":
      return "shot";
    case "shot":
      return "after";
    case "after":
      return "before";
  }
}

function cycleHoldMs(kind: CycleKind, p: CyclePhase): number {
  return p === "shot" ? EVENT_MS[kind] : REST_MS;
}

/**
 * Waking: Dormant, then the wake (connecting with the wake event), then Connecting; back to Dormant, so the doze is
 * seen too. Celebrate: Speaking, then Celebrate over speaking, then Speaking.
 */
function cycleInput(kind: CycleKind, p: CyclePhase): AvatarInput {
  if (kind === "wake") {
    if (p === "before") return avatarInput("closed", null, { reduced: false });
    if (p === "shot") return avatarInput("connecting", "wake", { reduced: false });
    return avatarInput("connecting", null, { reduced: false });
  }
  return avatarInput("speaking", p === "shot" ? "celebrate" : null, { reduced: false });
}

function useCycle(kind: CycleKind | null): AvatarInput | null {
  const [phase, setPhase] = useState<CyclePhase>("before");
  const hold = kind === null ? null : cycleHoldMs(kind, phase);
  useEffect(() => {
    if (hold === null) return;
    const id = setTimeout(() => setPhase(cycleNext), hold);
    return () => clearTimeout(id);
  }, [phase, hold]);
  return kind === null ? null : cycleInput(kind, phase);
}

/* ---------------------------------------------------------------------
   On screen: a tile mounts its engine only while it is in view.
   --------------------------------------------------------------------- */

const ON_SCREEN_MARGIN = "120px 0px";

function useOnScreen(): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    if (el === null || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setOnScreen(entry.isIntersecting);
      },
      { rootMargin: ON_SCREEN_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  return [setEl, onScreen];
}

/* ---------------------------------------------------------------------
   The engine readout: tier, fps and build timings, polled from the live engine.
   --------------------------------------------------------------------- */

type EngineReadout =
  | { status: "none" }
  | { status: "live"; stats: EngineStats; timings: EngineTimings }
  | { status: "unreadable"; detail: string };

const NO_READOUT: EngineReadout = Object.freeze({ status: "none" });
const STATS_EVERY_MS = 500;

function readoutOf(engine: AvatarEngine | null): EngineReadout {
  if (engine === null) return NO_READOUT;
  try {
    return { status: "live", stats: engine.stats(), timings: engine.timings() };
  } catch (e) {
    return { status: "unreadable", detail: e instanceof Error ? e.message : String(e) };
  }
}

/** One per tile. ThreeHostDeps.onEngine feeds it; the tile reads it through useSyncExternalStore. */
interface EngineWatch {
  onEngine(engine: AvatarEngine | null): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): EngineReadout;
  getServerSnapshot(): EngineReadout;
  dispose(): void;
}

function createEngineWatch(): EngineWatch {
  let engine: AvatarEngine | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let snapshot: EngineReadout = NO_READOUT;
  const listeners = new Set<() => void>();
  const publish = () => {
    snapshot = readoutOf(engine);
    for (const l of listeners) l();
  };
  const stopPolling = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  return {
    onEngine(next) {
      engine = next;
      stopPolling();
      if (next !== null) timer = setInterval(publish, STATS_EVERY_MS);
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => NO_READOUT,
    dispose() {
      engine = null;
      stopPolling();
    },
  };
}

const ms = (x: number) => `${Math.round(x)} ms`;

function timingLine(t: EngineTimings): string {
  const stage = t.steps.find((s) => s.name === "stage")?.ms ?? 0;
  return `build ${ms(t.totalMs)} · stage ${ms(stage)} · longest other step ${ms(t.longestCpuStepMs)} · warm ${ms(t.warmMs)} · settle ${ms(t.settleMs)} · programs ${t.programs.afterWarm}/${t.programs.afterSettle}`;
}

function Readout({ readout, onScreen }: { readout: EngineReadout; onScreen: boolean }) {
  if (readout.status === "none") {
    return (
      <p data-three-readout="none" className="max-w-[300px] text-center font-mono text-xs text-ink-dim">
        {onScreen ? "no engine yet" : "off screen: no engine"}
      </p>
    );
  }
  if (readout.status === "unreadable") {
    return (
      <p data-three-readout="unreadable" className="max-w-[300px] text-center font-mono text-xs text-ink-dim">
        {readout.detail}
      </p>
    );
  }
  const { stats, timings } = readout;
  return (
    <p data-three-readout="live" className="max-w-[300px] text-center font-mono text-xs text-ink-dim">
      {`${stats.quality} · ${stats.fps.toFixed(0)} fps · ${stats.state}`}
      <br />
      {timingLine(timings)}
      {stats.errors.length > 0 ? (
        <>
          <br />
          {`${stats.errors.length} errors, newest: ${stats.errors[stats.errors.length - 1]}`}
        </>
      ) : null}
    </p>
  );
}

/* ---------------------------------------------------------------------
   One pair: the SVG ghost beside the three.js ghost.
   --------------------------------------------------------------------- */

/** A fixed input, or a cycle whose `input` is its first phase (what the server renders). */
interface PairSpec {
  id: string;
  label: string;
  input: AvatarInput;
  cycle?: CycleKind;
}

function ThreePair({ spec }: { spec: PairSpec }) {
  const cycled = useCycle(spec.cycle ?? null);
  const input = cycled ?? spec.input;
  const look = lookFor(input);
  const [watch] = useState(createEngineWatch);
  const [Renderer] = useState(() =>
    createThreeGhost(() => ({ ...browserThreeHost(), budget: createElectricityBudget(1), onEngine: watch.onEngine })),
  );
  const [source] = useState(() => createSpeechSource({ still: false }));
  const [setBox, onScreen] = useOnScreen();
  const readout = useSyncExternalStore(watch.subscribe, watch.getSnapshot, watch.getServerSnapshot);
  useEffect(() => () => watch.dispose(), [watch]);

  return (
    <ReducedMotionOverride reduced={input.reducedMotion}>
      <Tile
        label={`${spec.label} → ${look.name}${look.ghost ? " (ghost)" : ""}`}
        data-specimen="avatar-three"
        data-three-tile={spec.id}
        data-three-look={look.name}
        data-specimen-reduced={input.reducedMotion ? "true" : "false"}
      >
        <div ref={setBox} className="flex items-start gap-4">
          <div className="flex w-36 flex-col items-center gap-1">
            <Stage reduced={input.reducedMotion}>
              <Avatar look={look} input={input} renderer={SvgGhost} />
            </Stage>
            <span className="font-mono text-xs text-ink-dim">SVG</span>
          </div>
          <div className="flex w-36 flex-col items-center gap-1">
            <Stage reduced={input.reducedMotion}>
              <AvatarAudioContext.Provider value={source}>
                <Avatar look={look} input={input} renderer={onScreen ? Renderer : SvgGhost} />
              </AvatarAudioContext.Provider>
            </Stage>
            <span className="font-mono text-xs text-ink-dim">three.js</span>
          </div>
        </div>
        <Readout readout={readout} onScreen={onScreen} />
      </Tile>
    </ReducedMotionOverride>
  );
}

const off = { reduced: false };

/** Every Look_Name with Reduced_Motion off, ghost over Listening and Speaking, and the reduced fallback: 13 pairs, 12 engines. */
const PAIRS: readonly PairSpec[] = [
  { id: "dormant", label: "closed", input: avatarInput("closed", null, off) },
  { id: "waking", label: "closed, wake, connecting (cycles)", input: cycleInput("wake", "before"), cycle: "wake" },
  { id: "connecting", label: "connecting", input: avatarInput("connecting", null, off) },
  { id: "listening", label: "listening, simulated user voice", input: avatarInput("listening", null, off) },
  { id: "thinking", label: "thinking", input: avatarInput("thinking", null, off) },
  { id: "speaking", label: "speaking, simulated Franki voice", input: avatarInput("speaking", null, off) },
  { id: "recovery", label: "recovery", input: avatarInput("recovery", null, off) },
  { id: "presenting", label: "speaking + present-card", input: avatarInput("speaking", "present-card", off) },
  { id: "awaiting", label: "listening + await-approval", input: avatarInput("listening", "await-approval", off) },
  { id: "celebrate", label: "speaking, celebrate, speaking (cycles)", input: cycleInput("celebrate", "before"), cycle: "celebrate" },
  { id: "ghost-listening", label: "listening, mic muted", input: avatarInput("listening", null, { reduced: false, ghost: true }) },
  { id: "ghost-speaking", label: "speaking, mic muted", input: avatarInput("speaking", null, { reduced: false, ghost: true }) },
  { id: "reduced", label: "listening, Reduced_Motion on: the fallback", input: avatarInput("listening", null, { reduced: true }) },
];

/* ---------------------------------------------------------------------
   The still parity panel (§8.2 item 1): Acting literals, not looks, because the engine never reads `name`.
   --------------------------------------------------------------------- */

type Still = "idle" | "thinking" | "muted" | "celebrate" | "speaking" | "listening";
const STILLS: readonly Still[] = ["idle", "thinking", "muted", "celebrate", "speaking", "listening"];

/** `name` is the look whose acting the literal matches (Waking's acting without its one-shot is plain idle). */
const IDLE: Acting = { name: "Waking", pose: "idle", overlay: "none", oneShot: null, ghost: false, mic: false, voice: false, electric: false };
const PARITY_ACTING: Readonly<Record<Still, Acting>> = Object.freeze({
  idle: IDLE,
  thinking: { ...IDLE, name: "Thinking", pose: "thinking", electric: true },
  muted: { ...IDLE, ghost: true },
  celebrate: { ...IDLE, name: "Celebrate", oneShot: "celebrate" },
  speaking: { ...IDLE, name: "Speaking", pose: "speaking", voice: true },
  listening: { ...IDLE, name: "Listening", pose: "listening", mic: true },
});

/** The prototype's parity frame, and its default quality (no ?quality= is "auto"). */
const PARITY_SIZE: Readonly<Size> = Object.freeze({ w: 1280, h: 900 });
const PARITY_OPTIONS: Readonly<EngineOptions> = Object.freeze({ still: true, quality: "auto" });

/** `run` counts builds, so a result from a build that was replaced or closed is dropped. */
type ParityState =
  | { phase: "off"; run: number }
  | { phase: "building"; run: number; still: Still }
  | { phase: "ready"; run: number; still: Still; report: string }
  | { phase: "failed"; run: number; still: Still; detail: string };

type ParityEvent =
  | { kind: "select"; still: Still }
  | { kind: "close" }
  | { kind: "ready"; run: number; report: string }
  | { kind: "failed"; run: number; detail: string };

const INITIAL_PARITY: ParityState = Object.freeze({ phase: "off", run: 0 });

/** Total: every pair not listed returns the state unchanged. */
function parityStep(s: ParityState, e: ParityEvent): ParityState {
  switch (e.kind) {
    case "select":
      return { phase: "building", run: s.run + 1, still: e.still };
    case "close":
      return s.phase === "off" ? s : { phase: "off", run: s.run };
    case "ready":
      return s.phase === "building" && e.run === s.run ? { phase: "ready", run: s.run, still: s.still, report: e.report } : s;
    case "failed":
      return (s.phase === "building" || s.phase === "ready") && e.run === s.run ? { phase: "failed", run: s.run, still: s.still, detail: e.detail } : s;
  }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ParityPanel() {
  const [state, dispatch] = useReducer(parityStep, INITIAL_PARITY);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const activeRun = state.phase === "off" ? null : state.run;
  const activeStill = state.phase === "off" ? null : state.still;

  useEffect(() => {
    if (activeRun === null || activeStill === null || box === null) return;
    const run = activeRun;
    const abort = new AbortController();
    const deps = browserThreeHost();
    const source = createSpeechSource({ still: true });
    let engine: AvatarEngine | null = null;
    const onEvent = (e: EngineEvent) => {
      if (e.kind === "failed") dispatch({ kind: "failed", run, detail: `${e.reason}: ${e.detail}` });
    };
    Promise.resolve()
      .then(() => {
        if (!deps.probeWebGL2()) throw new Error("no WebGL 2 with a float colour buffer");
        return deps.loadEngine();
      })
      .then((mod) => mod.createEngine(box, { ...PARITY_SIZE }, { ...PARITY_ACTING[activeStill] }, { ...PARITY_OPTIONS }, deps.engineHost(source, onEvent), abort.signal))
      .then(
        (built) => {
          if (abort.signal.aborted) {
            built.dispose();
            return;
          }
          engine = built;
          built.pause(false);
          const stats = built.stats();
          dispatch({ kind: "ready", run, report: `${stats.quality} · ${timingLine(built.timings())}` });
        },
        (e: unknown) => {
          if (!abort.signal.aborted) dispatch({ kind: "failed", run, detail: messageOf(e) });
        },
      );
    return () => {
      abort.abort();
      engine?.dispose();
      engine = null;
    };
  }, [activeRun, activeStill, box]);

  const status =
    state.phase === "off"
      ? "Pick a still. One engine at a time, still: true, 1280 x 900."
      : state.phase === "building"
        ? `${state.still}: building`
        : state.phase === "ready"
          ? `${state.still}: ${state.report}`
          : `${state.still}: failed, ${state.detail}`;

  return (
    <div data-three-parity={state.phase} className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {STILLS.map((still) => (
          <button
            key={still}
            type="button"
            data-three-still={still}
            aria-pressed={activeStill === still}
            className={QUIET_BUTTON}
            onClick={() => dispatch({ kind: "select", still })}
          >
            {still}
          </button>
        ))}
        <button type="button" data-three-still="close" className={QUIET_BUTTON} onClick={() => dispatch({ kind: "close" })}>
          Close
        </button>
      </div>
      <p className="font-mono text-xs text-ink-dim">
        {status}
        {activeStill !== null ? ` · compare with the prototype at ?still=1&state=${activeStill}` : ""}
      </p>
      <div className="w-full overflow-auto rounded-card border border-stitch">
        <div ref={setBox} data-three-parity-box="" className="relative h-[900px] w-[1280px]" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   The section.
   --------------------------------------------------------------------- */

export function ThreeSection() {
  return (
    <>
      <Section id="avatar-three" title="Avatar, three.js beside SVG">
        {PAIRS.map((spec) => (
          <ThreePair key={spec.id} spec={spec} />
        ))}
      </Section>
      <Section id="avatar-three-parity" title="Avatar, three.js still parity">
        <ParityPanel />
      </Section>
    </>
  );
}
