// The single shared AudioContext of a Visit (lab-ui-foundation R11.7, R19.2). It is created on the
// first `pointerdown` or `keydown` of the Visit (the call button press counts), never before.

export interface GestureTarget {
  addEventListener(type: "pointerdown" | "keydown", listener: () => void, options?: { capture?: boolean }): void;
  removeEventListener(type: "pointerdown" | "keydown", listener: () => void, options?: { capture?: boolean }): void;
}

export type ContextFactory = () => AudioContext;

const GESTURES = ["pointerdown", "keydown"] as const;

export class SharedAudio {
  private context: AudioContext | null = null;
  private gestured = false;
  private readonly onGesture = () => this.gesture();

  constructor(
    private readonly target: GestureTarget | null,
    private readonly create: ContextFactory | null,
  ) {
    for (const type of GESTURES) target?.addEventListener(type, this.onGesture, { capture: true });
  }

  /** True once the Visit has had a user gesture. */
  hasGesture(): boolean {
    return this.gestured;
  }

  /** The shared context, or null before the first gesture or when Web Audio is missing. */
  getContext(): AudioContext | null {
    return this.context;
  }

  private gesture(): void {
    if (this.gestured) return;
    this.gestured = true;
    this.detach();
    try {
      this.context = this.create?.() ?? null;
    } catch {
      this.context = null;
    }
  }

  private detach(): void {
    for (const type of GESTURES) this.target?.removeEventListener(type, this.onGesture, { capture: true });
  }

  dispose(): void {
    this.detach();
  }
}

let shared: SharedAudio | null = null;

/** The Visit's SharedAudio, attached to the browser window on first use. Null on the server. */
export function sharedAudio(): SharedAudio | null {
  if (typeof window === "undefined") return null;
  if (shared === null) {
    const Ctor = window.AudioContext;
    shared = new SharedAudio(window, typeof Ctor === "function" ? () => new Ctor() : null);
  }
  return shared;
}
