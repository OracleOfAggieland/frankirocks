"use client";
// The X-ray machine on the stage (brief 051 part B), for part D to place. One tile walks the machine through every
// state beside the three.js ghost at the Main_Screen's own stage size, so its place against the real Franki can be
// judged. The full form adds the machine alone in every state (with "off" under a held hover), a switch that draws
// that whole row still under Reduced_Motion, and the no-WebGL fallback. Each machine and each ghost is one WebGL
// context: the short form holds two, the full form seven (the walk's two and the row's five, shown five states at a
// time); the fallback holds none.
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "../../../components/avatar/Avatar";
import { Stage } from "../../../components/avatar/Stage";
import { XrayOnStage, XrayProp } from "../../../components/xray/XrayOnStage";
import { lookFor } from "../../../ui/avatar/look";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import type { XrayPropView } from "../../../ui/xray/types";
import { avatarInput } from "../_fixtures";
import { Section, Tile } from "./Section";

const noop = () => {};

const OFF: XrayPropView = { power: "off", signal: "dark" };
const on = (signal: XrayPropView["signal"]): XrayPropView => ({ power: "on", signal });

/** Off, then a press: asking, warming, searching, seeing; then the tracker gone, a refusal, no camera, a hidden tab. */
const WALK: { view: XrayPropView; ms: number }[] = [
  { view: OFF, ms: 2500 },
  { view: on("asking"), ms: 2500 },
  { view: on("warming"), ms: 2500 },
  { view: on("searching"), ms: 4000 },
  { view: on("seeing"), ms: 5000 },
  { view: on("filmOnly"), ms: 3500 },
  { view: on("blocked"), ms: 3000 },
  { view: on("noCamera"), ms: 3500 },
  { view: on("paused"), ms: 4000 },
];

/** Every state the machine draws, with off twice: alone, and under a held hover. */
const STATES: { id: string; label: string; view: XrayPropView; hover: boolean }[] = [
  { id: "off", label: "off", view: OFF, hover: false },
  { id: "off-hover", label: "off, hover", view: OFF, hover: true },
  { id: "asking", label: "asking", view: on("asking"), hover: false },
  { id: "warming", label: "warming", view: on("warming"), hover: false },
  { id: "searching", label: "searching", view: on("searching"), hover: false },
  { id: "seeing", label: "seeing", view: on("seeing"), hover: false },
  { id: "film-only", label: "film only", view: on("filmOnly"), hover: false },
  { id: "blocked", label: "blocked", view: on("blocked"), hover: false },
  { id: "no-camera", label: "no camera", view: on("noCamera"), hover: false },
  { id: "paused", label: "paused", view: on("paused"), hover: false },
];

/** Room on the right for the machine, which stands past the stage's edge. */
const ROOM = "flex w-[44rem] max-w-full justify-center py-16 pr-40";
/** A state tile's box: about the size the machine is drawn on the stage. */
const BOX = "relative size-40";
const FILL = "absolute inset-0";

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
      <Tile label={`every state → ${view.power === "off" ? "off" : view.signal}`} data-specimen="xray-prop" data-xray-tile="walk" data-xray-walk={view.signal}>
        <div className={ROOM}>
          <Stage reduced={false} aside={<XrayOnStage view={view} onPress={noop} />}>
            <Avatar look={lookFor(input)} input={input} />
          </Stage>
        </div>
      </Tile>
    </ReducedMotionOverride>
  );
}

/** One machine alone in one state. A held hover stays on; otherwise the pointer or focus warms it, as on the stage. */
function StateTile({ id, label, view, hover, reduced }: { id: string; label: string; view: XrayPropView; hover: boolean; reduced: boolean }) {
  const [pointer, setPointer] = useState(false);
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  return (
    <Tile label={reduced ? `${label}, still` : label} data-specimen="xray-prop" data-xray-tile={id} data-specimen-reduced={reduced ? "true" : "false"}>
      <div className={BOX}>
        <XrayProp view={view} onPress={noop} reduced={reduced} failed={failed} hover={hover || pointer} onHover={setPointer} onFail={onFail} place={FILL} />
      </div>
    </Tile>
  );
}

/** How many state tiles show at once (brief 051 part D: a page keeps to nine WebGL contexts). */
const STATES_SHOWN = 5;

/**
 * The row of every state, moving or, at the switch, still under Reduced_Motion, five at a time: five contexts, with
 * a second switch for the other five.
 */
function StateRow() {
  const [reduced, setReduced] = useState(false);
  const [later, setLater] = useState(false);
  const shown = later ? STATES.slice(STATES_SHOWN) : STATES.slice(0, STATES_SHOWN);
  return (
    <>
      <label className="flex min-h-11 w-full items-center gap-2 text-sm text-ink-dim">
        <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} data-xray-reduced="" />
        Reduced_Motion on (every machine drawn still)
      </label>
      <label className="flex min-h-11 w-full items-center gap-2 text-sm text-ink-dim">
        <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} data-xray-later="" />
        Show the other five states
      </label>
      <ReducedMotionOverride reduced={reduced}>
        {shown.map((s) => (
          <StateTile key={`${s.id}-${reduced ? "still" : "moving"}`} {...s} reduced={reduced} />
        ))}
      </ReducedMotionOverride>
    </>
  );
}

/** The machine as words, as it is when WebGL can't be had: no context. */
function FallbackTile({ view, id, label }: { view: XrayPropView; id: string; label: string }) {
  return (
    <Tile label={label} data-specimen="xray-prop" data-xray-tile={id}>
      <div className={BOX}>
        <XrayProp view={view} onPress={noop} reduced={false} failed hover={false} onHover={noop} onFail={noop} place={FILL} />
      </div>
    </Tile>
  );
}

/**
 * `full`: every tile of the machine on the stage. Short, for a page near the browser's WebGL context limit: the walk
 * and the fallback alone (two contexts).
 */
export function XrayPropSection({ full }: { full: boolean }) {
  return (
    <>
      <Section id="xray-prop" title="X-ray machine on the stage">
        <WalkTile />
        <FallbackTile view={OFF} id="fallback-off" label="no WebGL, off" />
        <FallbackTile view={on("seeing")} id="fallback-on" label="no WebGL, on" />
      </Section>
      {full ? (
        <Section id="xray-prop-states" title="X-ray machine, each state">
          <StateRow />
        </Section>
      ) : null}
    </>
  );
}
