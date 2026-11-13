"use client";
// The radio on the stage (brief 047). One tile walks the radio through every state beside the three.js ghost at
// the Main_Screen's own stage size, so its place against the real Franki can be judged. The full form, on
// /specimens/radio, adds the real watch by hand (with a line to say the phrase to it), the radio still under
// Reduced_Motion, and the globe panel inline in each signal. Each radio, ghost and globe is one WebGL context:
// the short form on the main Specimens_Page holds two, the full form at most ten.
import { AnimatePresence } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { browserRadioPlayer, type RadioPlayerPort, type RadioTimers } from "../../../client/radio-player";
import { RadioWatch } from "../../../client/radio-watch";
import { Avatar } from "../../../components/avatar/Avatar";
import { Stage } from "../../../components/avatar/Stage";
import { SvgGhost } from "../../../components/avatar/SvgGhost";
import { RadioOnStage } from "../../../components/radio/RadioOnStage";
import { RadioPanel } from "../../../components/radio/RadioPanel";
import { FOCUS, QUIET_BUTTON, TARGET } from "../../../components/surfaces/classes";
import { lookFor } from "../../../ui/avatar/look";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import { EVENT_MS } from "../../../ui/motion";
import { STATIONS } from "../../../ui/radio/stations";
import { RADIO_OFF_VIEW, type RadioControls, type RadioPropView, type RadioSignal, type RadioView, radioPropView } from "../../../ui/radio/types";
import { avatarInput } from "../_fixtures";
import { Section, Tile } from "./Section";

const noop = () => {};

const OFF: RadioPropView = { power: "off", signal: "silent", open: false };

/** Off, then on and tuning, playing with the globe open and closed, a dead stream, and a refused start. */
const WALK: { view: RadioPropView; ms: number }[] = [
  { view: OFF, ms: 2500 },
  { view: { power: "on", signal: "tuning", open: true }, ms: 4000 },
  { view: { power: "on", signal: "playing", open: true }, ms: 6000 },
  { view: { power: "on", signal: "playing", open: false }, ms: 5000 },
  { view: { power: "on", signal: "noSignal", open: true }, ms: 4000 },
  { view: { power: "on", signal: "tapToPlay", open: true }, ms: 4000 },
];

const STILL: { id: string; label: string; view: RadioPropView }[] = [
  { id: "off-reduced", label: "off", view: OFF },
  { id: "playing-reduced", label: "playing", view: { power: "on", signal: "playing", open: false } },
  { id: "no-signal-reduced", label: "no signal", view: { power: "on", signal: "noSignal", open: true } },
];

/** Room on the left for the radio, which stands past the stage's edge. */
const ROOM = "flex w-[44rem] max-w-full justify-center py-16 pl-40";

function WalkTile() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setStep((s) => (s + 1) % WALK.length), WALK[step]!.ms);
    return () => clearTimeout(timer);
  }, [step]);
  const { view } = WALK[step]!;
  const input = avatarInput("listening", null, { reduced: false });
  return (
    <ReducedMotionOverride reduced={false}>
      <Tile label={`every state → ${view.power === "off" ? "off" : view.signal}${view.open ? ", globe open" : ""}`} data-specimen="radio" data-radio-tile="walk" data-radio-walk={view.signal}>
        <div className={ROOM}>
          <Stage reduced={false} aside={<RadioOnStage view={view} onPress={noop} />}>
            <Avatar look={lookFor(input)} input={input} />
          </Stage>
        </div>
      </Tile>
    </ReducedMotionOverride>
  );
}

function StillTile({ id, label, view }: { id: string; label: string; view: RadioPropView }) {
  const input = avatarInput("listening", null, { reduced: true });
  return (
    <ReducedMotionOverride reduced>
      <Tile label={label} data-specimen="radio" data-radio-tile={id} data-specimen-reduced="true">
        <div className={ROOM}>
          <Stage reduced aside={<RadioOnStage view={view} onPress={noop} />}>
            <Avatar look={lookFor(input)} input={input} renderer={SvgGhost} />
          </Stage>
        </div>
      </Tile>
    </ReducedMotionOverride>
  );
}

const TIMERS: RadioTimers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

/** A player with no sound: every station "starts" after a moment, so the screen can be walked in silence. */
function silentPlayer(): RadioPlayerPort {
  const listeners = new Set<(tune: number, report: "playing") => void>();
  let timer: number | null = null;
  const clear = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  return {
    load: (_url, tune) => {
      clear();
      timer = window.setTimeout(() => listeners.forEach((l) => l(tune, "playing")), 1200);
    },
    stop: clear,
    setGain: noop,
    onReport: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: clear,
  };
}

const noSubscribe = () => noop;
const offView = (): RadioView => RADIO_OFF_VIEW;

/** The line under the live tile's stage: what the owner would type to Franki, sent to the watch as a typed line. */
function SayLine({ onSay }: { onSay: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() === "") return;
        onSay(text);
        setText("");
      }}
    >
      <label className="flex flex-col gap-1 text-sm text-ink-dim">
        Say it to Franki
        <input
          type="text"
          data-radio-say=""
          value={text}
          placeholder="Franki, you rock"
          onChange={(e) => setText(e.currentTarget.value)}
          className={`${TARGET} ${FOCUS} rounded-control border border-ink/20 bg-night-1 px-3 text-sm text-ink`}
        />
      </label>
      <button type="submit" data-action="radio-say" className={`${QUIET_BUTTON} text-sm`}>
        Send
      </button>
    </form>
  );
}

/**
 * The real watch and machine, by hand: press the radio, spin the globe, pick a light, or say the phrase. The rock
 * phrase makes the ghost celebrate (the avatar's own celebrate event, for as long as it lasts), then listen again.
 * Sound only when asked for.
 */
function LiveTile({ sound }: { sound: boolean }) {
  const [watch, setWatch] = useState<RadioWatch | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const celebrateTimer = useRef<number | null>(null);
  useEffect(() => {
    const clearCelebrate = () => {
      if (celebrateTimer.current !== null) window.clearTimeout(celebrateTimer.current);
      celebrateTimer.current = null;
    };
    const onRock = () => {
      clearCelebrate();
      setCelebrating(true);
      celebrateTimer.current = window.setTimeout(() => {
        celebrateTimer.current = null;
        setCelebrating(false);
      }, EVENT_MS.celebrate);
    };
    const w = new RadioWatch({ player: sound ? browserRadioPlayer(TIMERS) : silentPlayer(), timers: TIMERS, random: Math.random, stations: STATIONS, onRock });
    setWatch(w);
    return () => {
      w.dispose();
      setWatch(null);
      clearCelebrate();
      setCelebrating(false);
    };
  }, [sound]);
  const view = useSyncExternalStore(watch?.subscribe ?? noSubscribe, watch?.getSnapshot ?? offView, offView);
  const input = avatarInput("listening", celebrating ? "celebrate" : null, { reduced: false });
  return (
    <ReducedMotionOverride reduced={false}>
      <Tile label={`by hand, ${sound ? "with sound" : "silent"} → ${view.power === "off" ? "off" : view.signal}`} data-specimen="radio" data-radio-tile={sound ? "live-sound" : "live"}>
        <div className={ROOM}>
          <Stage reduced={false} aside={<RadioOnStage view={radioPropView(view)} onPress={() => watch?.controls.press()} />}>
            <Avatar look={lookFor(input)} input={input} />
          </Stage>
        </div>
        <SayLine onSay={(text) => watch?.onTypedLine(text)} />
        <AnimatePresence>{watch !== null && view.panel === "open" ? <RadioPanel key="radio-panel" view={view} stations={STATIONS} controls={watch.controls} reduced={false} /> : null}</AnimatePresence>
      </Tile>
    </ReducedMotionOverride>
  );
}

/** One live tile at a time, so the page keeps one globe: silent first, and real stations on request. */
function LiveTiles() {
  const [sound, setSound] = useState(false);
  return (
    <>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink-dim">
        <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} data-radio-sound="" />
        Play the real stations
      </label>
      <LiveTile key={sound ? "sound" : "silent"} sound={sound} />
    </>
  );
}

const NO_CONTROLS: RadioControls = { press: noop, closePanel: noop, powerOff: noop, tune: noop, step: noop, spin: noop, setVolume: noop, retry: noop };
/** The station the panels show: a rock one, as "Franki, you rock" tunes to. */
const SHOWN = STATIONS.find((s) => s.rock) ?? STATIONS[0] ?? null;
const panelView = (signal: RadioSignal): RadioView => ({ power: "on", panel: "open", station: SHOWN, signal, volume: 0.8 });

/** The panel held in the page in the signals worth seeing, with the station list for the globe, so they cost no context. */
const PANELS: { id: string; label: string; signal: RadioSignal }[] = [
  { id: "panel-tuning", label: "panel, tuning", signal: "tuning" },
  { id: "panel-no-signal", label: "panel, no signal", signal: "noSignal" },
  { id: "panel-tap-to-play", label: "panel, tap to play", signal: "tapToPlay" },
];

function PanelTile({ id, label, signal }: { id: string; label: string; signal: RadioSignal }) {
  return (
    <Tile label={label} data-specimen="radio" data-radio-tile={id}>
      <RadioPanel view={panelView(signal)} stations={STATIONS} controls={NO_CONTROLS} reduced={false} presentation="inline" globe="list" />
    </Tile>
  );
}

/** The panel with the real globe, drawn still under Reduced_Motion. */
function ReducedGlobeTile() {
  return (
    <ReducedMotionOverride reduced>
      <Tile label="panel, playing, Reduced_Motion on" data-specimen="radio" data-radio-tile="panel-reduced" data-specimen-reduced="true">
        <RadioPanel view={panelView("playing")} stations={STATIONS} controls={NO_CONTROLS} reduced presentation="inline" />
      </Tile>
    </ReducedMotionOverride>
  );
}

/**
 * `full`: every radio tile, on /specimens/radio. Short, for the main Specimens_Page, which is near the browser's
 * WebGL context limit: the walk alone (two contexts) and a link to the full page.
 */
export function RadioSection({ full }: { full: boolean }) {
  if (!full) {
    return (
      <Section id="radio" title="Radio on the stage">
        <WalkTile />
        <Link href="/specimens/radio" data-radio-more="" className={`${FOCUS} self-center text-sm text-brass underline underline-offset-4 hover:text-brass-hi`}>
          Every radio and globe specimen
        </Link>
      </Section>
    );
  }
  return (
    <>
      <Section id="radio" title="Radio on the stage">
        <WalkTile />
      </Section>
      <Section id="radio-live" title="Radio and globe, by hand">
        <LiveTiles />
      </Section>
      <Section id="radio-reduced" title="Radio on the stage, Reduced_Motion on">
        {STILL.map((s) => (
          <StillTile key={s.id} id={s.id} label={s.label} view={s.view} />
        ))}
      </Section>
      <Section id="radio-panels" title="Globe panel, each signal">
        {PANELS.map((p) => (
          <PanelTile key={p.id} id={p.id} label={p.label} signal={p.signal} />
        ))}
        <ReducedGlobeTile />
      </Section>
    </>
  );
}
