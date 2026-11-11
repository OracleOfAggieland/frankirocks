// The three.js renderer's browser dependencies (brief 013, design note §3.3 three-host.ts), written in WP12.
// Injected, so the controller's tests run in node with fakes. browserThreeHost() touches no browser global until
// one of its methods is called, so it is safe to call during a server render. Only type imports from three/: the
// engine arrives through loadEngine's import(), the one way into three/.
import type { ElectricityBudget } from "../../ui/electricity-budget";
import type { AvatarAudioSource } from "../../ui/levels/audio-source";
import type * as EngineModule from "./three/engine";
import type { AvatarEngine, EngineEvent, EngineHost, EngineOptions } from "./three/engine";

export type LoadedEngine = typeof EngineModule;

export interface ThreeHostDeps {
  /** The app passes { still: false, quality: "auto" }. */
  options: EngineOptions;
  /**
   * WebGL 2 with a float colour buffer: getContext("webgl2") on a throwaway canvas and one of EXT_color_buffer_float or
   * EXT_color_buffer_half_float; then WEBGL_lose_context frees it at once. Memoised once per page.
   */
  probeWebGL2(): boolean;
  /** () => import("./three/engine"): the only dynamic import of the engine. */
  loadEngine(): Promise<LoadedEngine>;
  /** browserScheduler(), browserVisibility(), createBrowserClock().mono, a yield that lets the browser paint, the audio source. */
  engineHost(audio: AvatarAudioSource, onEvent: (e: EngineEvent) => void): EngineHost;
  /** ResizeObserver on the canvas layer, CSS pixels. Returns the disconnect. */
  observeSize(el: HTMLElement, cb: (w: number, h: number) => void): () => void;
  /** The screen's electricityBudget in the app; one budget per tile on the specimens page. */
  budget: ElectricityBudget;
  /** Told when an engine is ready and when it goes away (the specimens page reads stats from it). */
  onEngine?(engine: AvatarEngine | null): void;
}

export function browserThreeHost(): ThreeHostDeps {
  return notPorted("browserThreeHost");
}

function notPorted(name: string, ...inputs: unknown[]): never {
  throw new Error(`${name}: not ported yet (${inputs.length} inputs)`);
}
