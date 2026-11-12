"use client";
// The phone on Franki's wall, built in three.js. One tile walks two whole calls beside the three.js ghost at the
// Main_Screen's own stage size: one that is answered (dialing, ringing, talking, ended) and one that is not
// (dialing, ringing, missed), so every phase and the phone's place against the real Franki can be judged. Two more
// tiles show the same phone under Reduced_Motion, held still. Each phone on the page is one WebGL context, so
// there are three and no more.
import { useEffect, useState } from "react";
import { Avatar } from "../../../components/avatar/Avatar";
import { Stage } from "../../../components/avatar/Stage";
import { SvgGhost } from "../../../components/avatar/SvgGhost";
import { PhoneOnStage } from "../../../components/phone/PhoneOnStage";
import { lookFor } from "../../../ui/avatar/look";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import type { PhoneView } from "../../../ui/phone/phone-call";
import { avatarInput } from "../_fixtures";
import { Section, Tile } from "./Section";

const GONE: PhoneView = { phase: "absent", reason: null };

/** An answered call, a pause with nothing on the wall, then a call nobody picks up. */
const WALK: { view: PhoneView; ms: number }[] = [
  { view: GONE, ms: 1500 },
  { view: { phase: "dialing", reason: null }, ms: 5000 },
  { view: { phase: "ringing", reason: null }, ms: 5000 },
  { view: { phase: "talking", reason: null }, ms: 5000 },
  { view: { phase: "ended", reason: null }, ms: 3000 },
  { view: GONE, ms: 1500 },
  { view: { phase: "dialing", reason: null }, ms: 3500 },
  { view: { phase: "ringing", reason: null }, ms: 5000 },
  { view: { phase: "missed", reason: "noAnswer" }, ms: 3500 },
];

const STILL: { id: string; label: string; view: PhoneView }[] = [
  { id: "talking-reduced", label: "talking", view: { phase: "talking", reason: null } },
  { id: "busy-reduced", label: "missed: busy", view: { phase: "missed", reason: "busy" } },
];

/** Room on the right for the phone, which hangs past the stage's edge. */
const ROOM = "flex w-[44rem] max-w-full justify-center py-16 pr-40";

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
      <Tile label={`two whole calls → ${view.phase}`} data-specimen="phone" data-phone-tile="walk" data-phone-walk={view.phase}>
        <div className={ROOM}>
          <Stage reduced={false} aside={<PhoneOnStage view={view} />}>
            <Avatar look={lookFor(input)} input={input} />
          </Stage>
        </div>
      </Tile>
    </ReducedMotionOverride>
  );
}

function StillTile({ id, label, view }: { id: string; label: string; view: PhoneView }) {
  const input = avatarInput("listening", null, { reduced: true });
  return (
    <ReducedMotionOverride reduced>
      <Tile label={label} data-specimen="phone" data-phone-tile={id} data-specimen-reduced="true">
        <div className={ROOM}>
          <Stage reduced aside={<PhoneOnStage view={view} />}>
            <Avatar look={lookFor(input)} input={input} renderer={SvgGhost} />
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
      </Section>
      <Section id="phone-reduced" title="Phone on the wall, Reduced_Motion on">
        {STILL.map((s) => (
          <StillTile key={s.id} id={s.id} label={s.label} view={s.view} />
        ))}
      </Section>
    </>
  );
}
