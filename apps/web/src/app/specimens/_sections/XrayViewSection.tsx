"use client";
// The X-ray screen (brief 051 part C), with no camera: the scripted tracker stands in for one. The screen in
// `seeing` with a head that turns, nods and talks and two hands that wave and close; the same with the back camera
// (not mirrored); one tile for each other signal; the screen under Reduced_Motion; and the screen with no WebGL,
// which shows the film alone. A button opens the real modal at full size. The film behind the bones is dark here,
// since there is no picture. Each tile that draws bones is one WebGL context: four in all, five with the modal open.
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import { createBrowserClock } from "../../../client/clock";
import { XrayPanel } from "../../../components/xray/XrayPanel";
import { QUIET_BUTTON } from "../../../components/surfaces/classes";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import { SCRIPTED_ASPECT, createScriptedFeed } from "../../../ui/xray/testing/scripted-frames";
import type { XrayControls, XrayFeed, XraySignal, XrayView } from "../../../ui/xray/types";
import { Section, Tile } from "./Section";

const noop = () => {};
const CONTROLS: XrayControls = { press: noop, close: noop, flip: noop, retry: noop };

const on = (signal: XraySignal, more: Partial<XrayView> = {}): XrayView => ({ power: "on", signal, facing: "user", canFlip: true, cameraOn: true, ...more });

/** A feed that never finds anyone, and one that has no frame at all. */
const nobody = (now: () => number): XrayFeed => ({ attach: () => noop, latest: () => ({ at: now(), aspect: SCRIPTED_ASPECT, face: null, hands: [] }) });
const NO_FRAME: XrayFeed = { attach: () => noop, latest: () => null };

const OTHERS: { signal: XraySignal; view: XrayView; bones: "auto" | "none"; feed: "nobody" | "none" }[] = [
  { signal: "asking", view: on("asking", { cameraOn: false, canFlip: false }), bones: "none", feed: "none" },
  { signal: "warming", view: on("warming"), bones: "none", feed: "none" },
  { signal: "searching", view: on("searching"), bones: "auto", feed: "nobody" },
  { signal: "filmOnly", view: on("filmOnly"), bones: "none", feed: "none" },
  { signal: "blocked", view: on("blocked", { cameraOn: false, canFlip: false }), bones: "none", feed: "none" },
  { signal: "noCamera", view: on("noCamera", { cameraOn: false, canFlip: false }), bones: "none", feed: "none" },
  { signal: "paused", view: on("paused", { cameraOn: false }), bones: "none", feed: "none" },
];

export function XrayViewSection() {
  const clock = useMemo(() => createBrowserClock(), []);
  const now = useMemo(() => () => clock.mono(), [clock]);
  const live = useMemo(() => createScriptedFeed(now), [now]);
  const empty = useMemo(() => nobody(now), [now]);
  const [modal, setModal] = useState(false);
  const modalControls: XrayControls = useMemo(() => ({ ...CONTROLS, close: () => setModal(false) }), []);

  return (
    <>
      <Section id="xray-view" title="X-ray screen: seeing, scripted">
        <ReducedMotionOverride reduced={false}>
          <Tile label="seeing → selfie camera, mirrored" data-specimen="xray-view" data-xray-tile="seeing">
            <XrayPanel view={on("seeing")} feed={live} controls={CONTROLS} reduced={false} presentation="inline" />
          </Tile>
          <Tile label="seeing → back camera, not mirrored" data-specimen="xray-view" data-xray-tile="seeing-back">
            <XrayPanel view={on("seeing", { facing: "environment" })} feed={live} controls={CONTROLS} reduced={false} presentation="inline" />
          </Tile>
        </ReducedMotionOverride>
        <ReducedMotionOverride reduced>
          <Tile label="seeing → reduced motion: no grain, scan line or flicker" data-specimen="xray-view" data-xray-tile="seeing-reduced" data-specimen-reduced="true">
            <XrayPanel view={on("seeing")} feed={live} controls={CONTROLS} reduced presentation="inline" />
          </Tile>
        </ReducedMotionOverride>
        <Tile label="seeing → no WebGL: the film alone" data-specimen="xray-view" data-xray-tile="no-webgl">
          <XrayPanel view={on("seeing")} feed={live} controls={CONTROLS} reduced={false} presentation="inline" bones="none" />
        </Tile>
        <div className="flex w-full">
          <button type="button" data-action="xray-open-modal" className={`${QUIET_BUTTON} text-sm`} onClick={() => setModal(true)}>
            Open the screen as the app does (Escape closes it)
          </button>
        </div>
      </Section>
      <Section id="xray-view-signals" title="X-ray screen: every other signal">
        {OTHERS.map((o) => (
          <Tile key={o.signal} label={o.signal} data-specimen="xray-view" data-xray-tile={o.signal}>
            <XrayPanel view={o.view} feed={o.feed === "nobody" ? empty : NO_FRAME} controls={CONTROLS} reduced={false} presentation="inline" bones={o.bones} />
          </Tile>
        ))}
      </Section>
      <AnimatePresence>{modal ? <XrayPanel key="modal" view={on("seeing")} feed={live} controls={modalControls} reduced={false} /> : null}</AnimatePresence>
    </>
  );
}
