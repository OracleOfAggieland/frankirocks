"use client";
// Franki on the front door's stage (brief 015, package H2): the page's one <Avatar>, driven from the stage
// script with no call. One requestAnimationFrame loop feeds the frame time to the pure driver in
// ui/landing/stage-script.ts, which runs the Event_Controller's reducer; the look is published only when it
// changes, as the lab's frame loop does. Franki sleeps until the three.js layer reports it is showing (read
// from its data-three-phase attribute), or the SVG ghost is the one that stays, then wakes once. Under reduced
// motion Franki is simply awake. While Franki speaks, the demonstration voice is the avatar's audio source.
// The loop schedules no frame while the page is hidden.
//
// A soft halo and a floor shadow sit with Franki, as the lab's stage draws them; they hide while the three.js
// canvas shows, which draws its own light. On the server and the first paint Franki is asleep.
import { useEffect, useRef, useState } from "react";
import { lookFor } from "../../ui/avatar/look";
import type { AvatarInput, AvatarLook } from "../../ui/avatar/types";
import { browserScheduler, lookChanged } from "../../ui/hooks/frame-loop";
import { browserVisibility } from "../../ui/hooks/page-visible";
import { type DemoVoice, type VoicePlan, createDemoVoice, envelopeAt } from "../../ui/landing/demo-voice";
import { type DriverState, type SceneFranki, asleepInput, driverInput, driverStep, initialDriver } from "../../ui/landing/stage-script";
import { Avatar } from "../avatar/Avatar";
import { AvatarAudioContext } from "../avatar/avatar-audio";

export interface DemoAvatarProps {
  franki: SceneFranki;
  /** The sentence being said while `franki.speaking`, or null. */
  speech: VoicePlan | null;
  reduced: boolean;
  /** Told every frame, with the frame time and whether Franki has woken. */
  onFrame?: (at: number, awake: boolean) => void;
}

/** The SVG ghost's electricity is given a new frame time at most this often, in ms (the lab's pace). */
const ELECTRIC_STEP_MS = 60;

interface View {
  look: AvatarLook;
  input: AvatarInput;
  frameTime: number;
}

function initialView(reduced: boolean): View {
  const input = asleepInput(reduced);
  return { look: lookFor(input), input, frameTime: 0 };
}

export function DemoAvatar({ franki, speech, reduced, onFrame }: DemoAvatarProps) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => initialView(reduced));
  const [voice] = useState<DemoVoice>(() => createDemoVoice());

  // The latest props, read by the loop.
  const latest = useRef({ franki, speech, reduced, onFrame });
  useEffect(() => {
    latest.current = { franki, speech, reduced, onFrame };
  });

  // The voice starts at the start of each sentence and stops with it.
  useEffect(() => {
    if (speech === null) return;
    voice.start(speech);
    return () => voice.stop();
  }, [speech, voice]);

  useEffect(() => {
    const scheduler = browserScheduler();
    const visibility = browserVisibility();
    let driver: DriverState = initialDriver;
    let published: { look: AvatarLook; input: AvatarInput } | null = null;
    let handle: unknown = null;
    let running = false;
    // Where the current sentence started on the frame clock.
    let speechFrom: { plan: VoicePlan; at: number } | null = null;
    // Frame time of the last publish, for the electricity's pace.
    let electricAt = Number.NEGATIVE_INFINITY;

    const phase = () => host.current?.querySelector("[data-three-phase]")?.getAttribute("data-three-phase") ?? null;

    const frame = (at: number) => {
      handle = null;
      if (!running) return;
      const p = latest.current;
      driver = driverStep(driver, { at, franki: p.franki, phase: phase(), reduced: p.reduced });
      if (p.speech === null) speechFrom = null;
      else if (speechFrom === null || speechFrom.plan !== p.speech) speechFrom = { plan: p.speech, at };
      const level = speechFrom === null ? 0 : envelopeAt(speechFrom.plan, (at - speechFrom.at) / 1000);
      const input = driverInput(driver, p.franki, { reduced: p.reduced, outputLevel: level });
      const look = lookFor(input);
      const shown = phase();
      if (lookChanged(published?.look ?? null, look)) {
        published = { look, input };
        electricAt = at;
        setView({ look, input, frameTime: at });
      } else if (published !== null && look.electric && shown !== "three" && at - electricAt >= ELECTRIC_STEP_MS) {
        // The SVG ghost's electricity regenerates on the frame time: the same look, a new time, at most every
        // ELECTRIC_STEP_MS, as the lab's controller publishes it.
        const same = published;
        electricAt = at;
        setView({ look: same.look, input: same.input, frameTime: at });
      }
      p.onFrame?.(at, driver.awake);
      handle = scheduler.request(frame);
    };
    const resume = () => {
      if (running) return;
      running = true;
      handle = scheduler.request(frame);
    };
    const pause = () => {
      running = false;
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
    };
    const unsubscribe = visibility.subscribe((visible) => (visible ? resume() : pause()));
    if (visibility.isVisible()) resume();
    return () => {
      unsubscribe();
      pause();
    };
  }, []);

  return (
    <div ref={host} data-demo-avatar="" data-reduced={reduced ? "true" : "false"} className="relative w-full">
      <span aria-hidden="true" data-demo-part="halo" className={`demo-halo pointer-events-none absolute inset-[-18%] rounded-full${reduced ? "" : " franki-anim franki-halo"}`} />
      <AvatarAudioContext.Provider value={voice}>
        <Avatar look={view.look} input={view.input} frameTime={view.frameTime} />
      </AvatarAudioContext.Provider>
      <span
        aria-hidden="true"
        data-demo-part="floor"
        className={`demo-floor pointer-events-none absolute left-[20%] top-[104%] aspect-[12/1] w-3/5 rounded-full${reduced ? "" : " franki-anim franki-floor"}`}
      />
    </div>
  );
}
