// One controller per mount of the three.js renderer (brief 013, design note §5.1), written in WP12. It holds the
// three machines' state (EdgeState, RendererState and, through the engine, LoopState), the engine handle, the
// Electricity grant and the size observer, and publishes a RendererView for ThreeGhost through
// useSyncExternalStore. It decides nothing itself: every transition is rendererStep, oneShotStep or loopStep.
//
// What it does do is carry out the view. After every renderer event it compares the phase before and after and runs
// the one action the new phase names: probe, load, build (createEngine on the sized transition only), settle on
// entry into fading-in, the engine's hold from the view's loop, and dispose on failed. Events raised while it is
// carrying one out (a synchronous probe, an engine event inside settle) are queued and stepped in order, so every
// action sees the state its own event produced.
import { type Acting, type EdgeState, INITIAL_EDGE, NO_COMMAND, actingFor, oneShotStep } from "../../ui/avatar/acting";
import {
  type EngineFailure,
  INITIAL_RENDERER,
  type Phase,
  type RendererEvent,
  type RendererState,
  type RendererView,
  rendererStep,
  rendererView,
  seesOneShots,
} from "../../ui/avatar/renderer-phase";
import type { AvatarInput, AvatarLook } from "../../ui/avatar/types";
import { type AvatarAudioSource, type AudioReader, NO_AUDIO } from "../../ui/levels/audio-source";
import type { AvatarEngine, EngineEvent, EngineTargets, Size } from "./three/engine";
import type { LoadedEngine, ThreeHostDeps } from "./three-host";

export interface ThreeGhostView extends RendererView {
  phase: Phase;
  failure: EngineFailure | null;
  /** The Electricity grant is held: the engine may draw arcs when the look is electric. */
  granted: boolean;
}

/** The phases in which the three.js ghost is on screen and may hold an Electricity grant (§4.4). */
const GRANT_PHASES: ReadonlySet<Phase> = new Set<Phase>(["fading-in", "three", "fading-out"]);

/** The phases a fading-in entered from must settle first, so the first visible 3D frame is the current look (§4.2). */
const SETTLE_FROM: ReadonlySet<Phase> = new Set<Phase>(["building", "waiting", "held", "lost"]);

function viewOf(s: RendererState, granted: boolean): ThreeGhostView {
  return { ...rendererView(s), phase: s.phase, failure: s.failure, granted };
}

let serverView: ThreeGhostView | null = null;

/** The SVG view of a fresh state: the server render and the first client render. One object, so React sees it stable. */
function svgView(): ThreeGhostView {
  if (serverView === null) serverView = Object.freeze(viewOf(INITIAL_RENDERER, false));
  return serverView;
}

/** The reason an EngineError carries. Read by shape: nothing outside three/ value-imports a file inside it (§6). */
function failureOf(err: unknown): EngineFailure {
  const reason = (err as { reason?: unknown } | null)?.reason;
  switch (reason) {
    case "no-webgl2":
    case "create":
    case "build":
    case "merge":
    case "shader":
    case "frames":
    case "aborted":
      return reason;
    default:
      return "build";
  }
}

/** One start-to-stop run. Callbacks from a promise or an engine compare their run with the current one. */
interface Run {
  readonly abort: AbortController;
}

export class ThreeGhostController {
  private state: RendererState = INITIAL_RENDERER;
  private edge: EdgeState = INITIAL_EDGE;
  private run: Run | null = null;
  private mod: LoadedEngine | null = null;
  private engine: AvatarEngine | null = null;
  /** The size the engine was last told, so a resize during the build reaches it once it is ready. */
  private engineSize: Size | null = null;
  private grant: number | null = null;
  private look: AvatarLook | null = null;
  private input: AvatarInput | null = null;
  private acting: Acting | null = null;
  private container: HTMLElement | null = null;
  private unobserve: (() => void) | null = null;
  /** The last non-zero box of the canvas layer. A 0 x 0 box keeps it (§5.1 Resize). */
  private size: Size | null = null;
  private audio: AvatarAudioSource | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshot: ThreeGhostView = svgView();
  private readonly queue: RendererEvent[] = [];
  private draining = false;

  /** What the engine reads: always this controller's current source, so a new context value needs no rebuild. */
  private readonly forwardingAudio: AvatarAudioSource = {
    read: (which: AudioReader, dt: number, time: Float32Array<ArrayBuffer>, db: Float32Array<ArrayBuffer>) =>
      (this.audio ?? NO_AUDIO).read(which, dt, time, db),
  };

  /** No side effects: Strict Mode constructs twice. */
  constructor(private readonly deps: ThreeHostDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ThreeGhostView => this.snapshot;

  /** The SVG view: the server and the first client render always show the SVG ghost. */
  getServerSnapshot = (): ThreeGhostView => svgView();

  /** Effect setup. Restartable: start, stop, start ends equal to one fresh start. */
  start(): void {
    if (this.run !== null) return;
    this.run = { abort: new AbortController() };
    // The look and input of an earlier run (Strict Mode, Fast Refresh) apply at once; a first mount waits for setLook.
    if (this.look !== null && this.input !== null) this.applyLook(this.look, this.input);
    else this.drain();
  }

  /** Effect cleanup: sends `stopped`, aborts a build, disposes the engine, releases the grant. */
  stop(): void {
    const run = this.run;
    if (run === null) return;
    // The run ends first, so nothing the `stopped` step leads to (an svg phase with reduced motion off) probes again.
    this.run = null;
    this.send({ kind: "stopped" });
    run.abort.abort();
    this.disposeEngine();
    this.releaseGrant();
    this.disconnect();
    this.mod = null;
    this.edge = INITIAL_EDGE;
    this.publish();
  }

  /** actingFor (with the input's attend), then oneShotStep with seesOneShots, then engine.setTargets; also the `reduced` event. */
  setLook(look: AvatarLook, input: AvatarInput): void {
    this.look = look;
    this.input = input;
    if (this.run === null) return;
    this.applyLook(look, input);
  }

  /** The engine reads a forwarding source, so a new context value needs no rebuild. Null reads silence. */
  setAudio(audio: AvatarAudioSource | null): void {
    this.audio = audio;
  }

  /** The canvas layer's ref callback. */
  attach = (container: HTMLElement | null): void => {
    if (container === this.container) return;
    this.disconnect();
    this.container = container;
    // The size belongs to the element it was measured on.
    this.size = null;
    if (container !== null && this.run !== null) this.observe(container);
  };

  /** From the SVG layer's own transitionend or animationend (event.target is the layer itself). */
  fadeDone(): void {
    if (this.run === null) return;
    this.send({ kind: "fade-done" });
  }

  /** From an effect keyed on [view.phase, look.electric], after the SVG layer's cleanup released its own grants. */
  syncGrant(): void {
    const wanted = this.run !== null && GRANT_PHASES.has(this.state.phase) && this.acting !== null && this.acting.electric;
    if (wanted && this.grant === null) {
      const token = this.deps.budget.request();
      if (token === null) return;
      this.grant = token;
      this.pushTargets(NO_COMMAND);
      this.publish();
    } else if (!wanted && this.grant !== null) {
      this.releaseGrant();
      this.pushTargets(NO_COMMAND);
      this.publish();
    }
  }

  // ---- The look ----

  private applyLook(look: AvatarLook, input: AvatarInput): void {
    // The acting is set first, so a settle that the reduced or one-shot event leads to shows this look.
    this.acting = actingFor(look, input.attend);
    this.send({ kind: "reduced", value: input.reducedMotion });
    const step = oneShotStep(this.edge, this.acting.oneShot, seesOneShots(this.state));
    this.edge = step.state;
    // The one-shot event first, the command after it: in waiting, a new one-shot that starts moves the phase into
    // fading-in, whose settle ends every one-shot (endOneShots). Sent the other way round, the settle would cut the
    // wake or celebrate it had just started, and the 3D ghost would fade in without it.
    this.send({ kind: "one-shot", skipped: step.state.skipped });
    this.pushTargets(step.command);
    // Wanted and denied: ask again on every look (§4.4).
    this.syncGrant();
  }

  /** The acting the engine sees: the look's electric only while the grant is held (§4.4). */
  private engineActing(): Acting | null {
    if (this.acting === null) return null;
    const electric = this.acting.electric && this.grant !== null;
    return electric === this.acting.electric ? this.acting : { ...this.acting, electric };
  }

  private pushTargets(command: EngineTargets["command"]): void {
    const acting = this.engineActing();
    if (this.engine === null || acting === null) return;
    this.engine.setTargets({ acting, command });
  }

  // ---- The renderer machine and its actions ----

  private send(e: RendererEvent): void {
    this.queue.push(e);
    this.drain();
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const e = this.queue.shift() ?? this.probeIfDue();
        if (e === null) break;
        const prev = this.state;
        this.state = rendererStep(prev, e);
        this.act(prev, this.state);
      }
    } finally {
      this.draining = false;
    }
    this.syncGrant();
    this.publish();
  }

  /**
   * The probe runs from the svg view with reduced motion off, whichever event got there (§5.1 Mount). Its answer
   * moves the phase off svg either way (loading or failed), so it runs once per run.
   */
  private probeIfDue(): RendererEvent | null {
    if (this.run === null || this.state.phase !== "svg" || rendererView(this.state).engine !== "probe") return null;
    let ok = false;
    try {
      ok = this.deps.probeWebGL2();
    } catch {
      ok = false;
    }
    return { kind: "probed", ok };
  }

  /** The one action the new phase names, on entry; and the engine's hold from the view's loop. */
  private act(prev: RendererState, next: RendererState): void {
    const run = this.run;
    if (run === null) return;
    const entered = prev.phase !== next.phase;
    if (entered) {
      switch (next.phase) {
        case "loading":
          this.load(run);
          break;
        case "mounting":
          this.awaitSize();
          break;
        case "building":
          this.build(run);
          break;
        case "fading-in":
          if (SETTLE_FROM.has(prev.phase)) {
            const acting = this.engineActing();
            if (this.engine !== null && acting !== null) this.engine.settle(acting);
          }
          break;
        case "failed":
          this.disposeEngine();
          break;
        default:
          break;
      }
    }
    const before = rendererView(prev).loop;
    const loop = rendererView(next).loop;
    if (this.engine !== null && (entered || before !== loop)) {
      // runs: frames advance. stopped (a lost context): the hold is released, so the engine's own loop machine can
      // draw the first good frame after a restore and say so; it draws nothing while the context is lost. held: held.
      if (loop === "runs" || loop === "stopped") this.engine.pause(false);
      else if (loop === "held") this.engine.pause(true);
    }
  }

  private load(run: Run): void {
    let pending: Promise<LoadedEngine>;
    try {
      pending = this.deps.loadEngine();
    } catch (err) {
      this.queue.push({ kind: "failed", reason: failureOf(err) });
      return;
    }
    pending.then(
      (mod) => {
        if (this.run !== run || this.state.phase !== "loading") return;
        this.mod = mod;
        this.send({ kind: "loaded" });
      },
      (err: unknown) => {
        if (this.run !== run) return;
        const reason = failureOf(err);
        if (reason !== "aborted") this.send({ kind: "failed", reason });
      },
    );
  }

  /** The container is rendered empty at opacity 0; the first non-zero box sends `sized`. */
  private awaitSize(): void {
    if (this.container === null) return;
    if (this.unobserve === null) this.observe(this.container);
    if (this.size !== null && this.state.phase === "mounting") this.queue.push({ kind: "sized" });
  }

  private build(run: Run): void {
    const mod = this.mod;
    const container = this.container;
    const size = this.size;
    const acting = this.engineActing();
    if (mod === null || container === null || size === null || acting === null) {
      this.queue.push({ kind: "failed", reason: "create" });
      return;
    }
    const host = this.deps.engineHost(this.forwardingAudio, (e) => this.onEngineEvent(run, e));
    let pending: Promise<AvatarEngine>;
    try {
      pending = mod.createEngine(container, { w: size.w, h: size.h }, acting, this.deps.options, host, run.abort.signal);
    } catch (err) {
      this.queue.push({ kind: "failed", reason: failureOf(err) });
      return;
    }
    pending.then(
      (engine) => {
        if (this.run !== run || this.state.phase !== "building") {
          // A mount that went away, or a phase that no longer wants it: exactly one live engine, so free this one.
          engine.dispose();
          return;
        }
        this.engine = engine;
        this.engineSize = { w: size.w, h: size.h };
        this.catchUpSize();
        // The look may have moved during the build; settle on entry into fading-in shows the latest.
        this.pushTargets(NO_COMMAND);
        this.deps.onEngine?.(engine);
        this.send({ kind: "ready" });
      },
      (err: unknown) => {
        if (this.run !== run) return;
        const reason = failureOf(err);
        if (reason !== "aborted") this.send({ kind: "failed", reason });
      },
    );
  }

  private onEngineEvent(run: Run, e: EngineEvent): void {
    if (this.run !== run) return;
    switch (e.kind) {
      case "lost":
        this.send({ kind: "lost" });
        break;
      case "restored":
        this.send({ kind: "restored" });
        break;
      case "failed":
        this.send({ kind: "failed", reason: e.reason });
        break;
      case "error":
        // Recorded inside the engine (stats().errors); frame errors count toward its own limit.
        break;
    }
  }

  // ---- Size ----

  private observe(el: HTMLElement): void {
    this.unobserve = this.deps.observeSize(el, (w, h) => this.onSize(w, h));
  }

  private disconnect(): void {
    this.unobserve?.();
    this.unobserve = null;
  }

  private onSize(w: number, h: number): void {
    if (!(w > 0 && h > 0)) return;
    this.size = { w, h };
    this.catchUpSize();
    if (this.run !== null && this.state.phase === "mounting") this.send({ kind: "sized" });
  }

  private catchUpSize(): void {
    const size = this.size;
    if (this.engine === null || size === null) return;
    if (this.engineSize !== null && this.engineSize.w === size.w && this.engineSize.h === size.h) return;
    this.engineSize = { w: size.w, h: size.h };
    this.engine.resize(size.w, size.h);
  }

  // ---- Resources ----

  private disposeEngine(): void {
    const engine = this.engine;
    if (engine === null) return;
    this.engine = null;
    this.engineSize = null;
    engine.dispose();
    this.deps.onEngine?.(null);
  }

  private releaseGrant(): void {
    if (this.grant === null) return;
    this.deps.budget.release(this.grant);
    this.grant = null;
  }

  private publish(): void {
    const granted = this.grant !== null;
    const s = this.snapshot;
    const v = rendererView(this.state);
    if (
      s.phase === this.state.phase &&
      s.failure === this.state.failure &&
      s.granted === granted &&
      s.svg === v.svg &&
      s.canvas === v.canvas &&
      s.engine === v.engine &&
      s.loop === v.loop
    )
      return;
    this.snapshot = { ...v, phase: this.state.phase, failure: this.state.failure, granted };
    this.listeners.forEach((l) => l());
  }
}
