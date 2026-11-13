"use client";
// The social card, 1200 x 630: the front door's words beside the three.js ghost in its celebrate pose, drawn once
// with still: true by the same engine the lab runs. app/opengraph-image.jpg is a capture of this box. To capture it
// again, run `next dev` and screenshot /specimens/card in a 1200 x 630 window once data-card-phase is "ready".
//
// Nothing here value-imports components/avatar/three/: the engine arrives only through browserThreeHost().loadEngine().
import { type CSSProperties, useEffect, useState } from "react";
import { browserThreeHost } from "../../../components/avatar/three-host";
import type { AvatarEngine, EngineEvent, EngineOptions, Size } from "../../../components/avatar/three/engine";
import type { Acting } from "../../../ui/avatar/acting";
import { LANDING } from "../../../ui/copy-landing";
import { createSpeechSource } from "../_sim/speech-synth";

/** The celebrate one-shot over plain idle, as the still parity panel draws it. */
const CELEBRATE: Readonly<Acting> = Object.freeze({
  name: "Celebrate",
  pose: "idle",
  overlay: "none",
  oneShot: "celebrate",
  ghost: false,
  mic: false,
  voice: false,
  electric: false,
});

const GHOST_SIZE: Readonly<Size> = Object.freeze({ w: 660, h: 630 });
const OPTIONS: Readonly<EngineOptions> = Object.freeze({ still: true, quality: "auto" });

/** Blends the engine's own backdrop into the card's night colour, as the lab's stage does. */
const GHOST_MASK: CSSProperties = {
  maskImage: "radial-gradient(closest-side, black 72%, transparent)",
  WebkitMaskImage: "radial-gradient(closest-side, black 72%, transparent)",
};

type Phase = "building" | "ready" | "failed";

export function SocialCard() {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>("building");

  useEffect(() => {
    if (box === null) return;
    const abort = new AbortController();
    const deps = browserThreeHost();
    let engine: AvatarEngine | null = null;
    const onEvent = (e: EngineEvent) => {
      if (e.kind === "failed") setPhase("failed");
    };
    Promise.resolve()
      .then(() => {
        if (!deps.probeWebGL2()) throw new Error("no WebGL 2 with a float colour buffer");
        return deps.loadEngine();
      })
      .then((mod) => mod.createEngine(box, { ...GHOST_SIZE }, { ...CELEBRATE }, { ...OPTIONS }, deps.engineHost(createSpeechSource({ still: true }), onEvent), abort.signal))
      .then(
        (built) => {
          if (abort.signal.aborted) {
            built.dispose();
            return;
          }
          engine = built;
          built.pause(false);
          setPhase("ready");
        },
        () => {
          if (!abort.signal.aborted) setPhase("failed");
        },
      );
    return () => {
      abort.abort();
      engine?.dispose();
      engine = null;
    };
  }, [box]);

  const { hero, build } = LANDING;
  return (
    <div data-card-phase={phase} className="relative h-[630px] w-[1200px] shrink-0 overflow-hidden bg-night-0 text-left">
      {/* The dev server's route indicator stays out of the capture. */}
      <style>{"nextjs-portal { display: none !important; }"}</style>
      <div ref={setBox} aria-hidden="true" className="absolute right-[-40px] top-0 h-[630px] w-[660px]" style={GHOST_MASK} />
      <div className="relative flex h-full w-[720px] flex-col justify-center gap-7 pl-[84px]">
        <p className="font-mono text-lg tracking-[0.3em] text-ink">{build.wordmark}</p>
        <p className="max-w-[24rem] font-mono text-base tracking-[0.08em] text-brass">{hero.eyebrow}</p>
        <h1 className="font-display text-[80px] leading-[1.04] text-ink">
          <span className="block whitespace-nowrap">{hero.headline.before}</span>
          <span className="block whitespace-nowrap">
            <em className="italic">{hero.headline.stitched}</em> {hero.headline.after}
          </span>
        </h1>
      </div>
    </div>
  );
}
