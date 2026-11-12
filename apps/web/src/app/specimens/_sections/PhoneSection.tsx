"use client";
// The phone on Franki's wall, in every phase and for every way a call is missed, each hung on a Stage beside
// the SVG ghost. One tile walks a whole call (dialing, ringing, talking, ended, gone) beside the three.js ghost
// at the Main_Screen's own stage size, so the phone's place against the real Franki can be judged.
import { useEffect, useState } from "react";
import { Avatar } from "../../../components/avatar/Avatar";
import { Stage } from "../../../components/avatar/Stage";
import { SvgGhost } from "../../../components/avatar/SvgGhost";
import { PhoneOnStage } from "../../../components/phone/RetroPhone";
import { lookFor } from "../../../ui/avatar/look";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import type { PhoneView } from "../../../ui/phone/phone-call";
import { avatarInput } from "../_fixtures";
import { Section, Tile } from "./Section";

const VIEWS: { id: string; label: string; view: PhoneView }[] = [
  { id: "dialing", label: "dialing", view: { phase: "dialing", reason: null } },
  { id: "ringing", label: "ringing", view: { phase: "ringing", reason: null } },
  { id: "talking", label: "talking", view: { phase: "talking", reason: null } },
  { id: "ended", label: "ended", view: { phase: "ended", reason: null } },
  { id: "busy", label: "missed: busy", view: { phase: "missed", reason: "busy" } },
  { id: "no-answer", label: "missed: no answer", view: { phase: "missed", reason: "noAnswer" } },
  { id: "failed", label: "missed: failed", view: { phase: "missed", reason: "failed" } },
  { id: "unconfirmed", label: "missed: unconfirmed", view: { phase: "missed", reason: "unconfirmed" } },
];

/** A whole call, then a pause with nothing on the wall. */
const WALK: { view: PhoneView; ms: number }[] = [
  { view: { phase: "absent", reason: null }, ms: 1500 },
  { view: { phase: "dialing", reason: null }, ms: 3500 },
  { view: { phase: "ringing", reason: null }, ms: 5000 },
  { view: { phase: "talking", reason: null }, ms: 5000 },
  { view: { phase: "ended", reason: null }, ms: 3000 },
];

function PhoneTile({ id, label, view, reduced }: { id: string; label: string; view: PhoneView; reduced: boolean }) {
  const input = avatarInput("listening", null, { reduced });
  return (
    <ReducedMotionOverride reduced={reduced}>
      <Tile label={label} data-specimen="phone" data-phone-tile={id} data-specimen-reduced={reduced ? "true" : "false"}>
        {/* Room on the right for the phone, which hangs past the stage's edge. */}
        <div className="w-44 pr-[38%]">
          <Stage reduced={reduced} aside={<PhoneOnStage view={view} />}>
            <Avatar look={lookFor(input)} input={input} renderer={SvgGhost} />
          </Stage>
        </div>
      </Tile>
    </ReducedMotionOverride>
  );
}

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
      <Tile label={`a whole call → ${view.phase}`} data-specimen="phone" data-phone-tile="walk" data-phone-walk={view.phase}>
        {/* The stage at its own width, with the default (three.js) renderer, and room around it for the canvas. */}
        <div className="flex w-[34rem] max-w-full justify-center py-16">
          <Stage reduced={false} aside={<PhoneOnStage view={view} />}>
            <Avatar look={lookFor(input)} input={input} />
          </Stage>
        </div>
      </Tile>
    </ReducedMotionOverride>
  );
}

export function PhoneSection() {
  return (
    <>
      <Section id="phone" title="Phone on the wall">
        <WalkTile />
        {VIEWS.map((v) => (
          <PhoneTile key={v.id} id={v.id} label={v.label} view={v.view} reduced={false} />
        ))}
      </Section>
      <Section id="phone-reduced" title="Phone on the wall, Reduced_Motion on">
        {VIEWS.slice(0, 5).map((v) => (
          <PhoneTile key={v.id} id={`${v.id}-reduced`} label={v.label} view={v.view} reduced />
        ))}
      </Section>
    </>
  );
}
