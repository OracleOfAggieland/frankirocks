// One controller per mount of the three.js renderer (brief 013, design note §5.1), written in WP12. It holds the
// three machines' state (EdgeState, RendererState and, through the engine, LoopState), the engine handle, the
// Electricity grant and the size observer, and publishes a RendererView for ThreeGhost through
// useSyncExternalStore. It decides nothing itself: every transition is rendererStep, oneShotStep or loopStep.
import type { AvatarInput, AvatarLook } from "../../ui/avatar/types";
import type { EngineFailure, Phase, RendererView } from "../../ui/avatar/renderer-phase";
import type { AvatarAudioSource } from "../../ui/levels/audio-source";
import type { ThreeHostDeps } from "./three-host";

export interface ThreeGhostView extends RendererView {
  phase: Phase;
  failure: EngineFailure | null;
  /** The Electricity grant is held: the engine may draw arcs when the look is electric. */
  granted: boolean;
}

export class ThreeGhostController {
  /** No side effects: Strict Mode constructs twice. */
  constructor(private readonly deps: ThreeHostDeps) {}

  subscribe(listener: () => void): () => void {
    return notPorted("subscribe", this.deps, listener);
  }

  getSnapshot(): ThreeGhostView {
    return notPorted("getSnapshot");
  }

  /** The SVG view: the server and the first client render always show the SVG ghost. */
  getServerSnapshot(): ThreeGhostView {
    return notPorted("getServerSnapshot");
  }

  /** Effect setup. Restartable: start, stop, start ends equal to one fresh start. */
  start(): void {
    notPorted("start");
  }

  /** Effect cleanup: sends `stopped`, aborts a build, disposes the engine, releases the grant. */
  stop(): void {
    notPorted("stop");
  }

  /** actingFor, then oneShotStep with seesOneShots, then engine.setTargets; also the `reduced` event. */
  setLook(look: AvatarLook, input: AvatarInput): void {
    notPorted("setLook", look, input);
  }

  /** The engine reads a forwarding source, so a new context value needs no rebuild. Null reads silence. */
  setAudio(audio: AvatarAudioSource | null): void {
    notPorted("setAudio", audio);
  }

  /** The canvas layer's ref callback. */
  attach(container: HTMLElement | null): void {
    notPorted("attach", container);
  }

  /** From the SVG layer's own transitionend or animationend (event.target is the layer itself). */
  fadeDone(): void {
    notPorted("fadeDone");
  }

  /** From an effect keyed on [view.phase, look.electric], after the SVG layer's cleanup released its own grants. */
  syncGrant(): void {
    notPorted("syncGrant");
  }
}

function notPorted(name: string, ...inputs: unknown[]): never {
  throw new Error(`ThreeGhostController.${name}: not ported yet (${inputs.length} inputs)`);
}
