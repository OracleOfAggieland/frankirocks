"use client";
// Every Look_Name, every Avatar_Event over every state, and Ghost_Mode over each state, each with
// Reduced_Motion off and forced on (R20.2). These tiles are pinned to the SVG ghost (brief 013 WP14), so they
// keep showing the SVG renderer after the default renderer becomes the three.js ghost; the three.js ghost has its
// own section, beside the SVG, with one engine per tile.
import { Avatar } from "../../../components/avatar/Avatar";
import { Stage } from "../../../components/avatar/Stage";
import { SvgGhost } from "../../../components/avatar/SvgGhost";
import { lookFor } from "../../../ui/avatar/look";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import { EVENTS, STATES, avatarInput } from "../_fixtures";
import { Section, Tile } from "./Section";

function Specimen({ input, label }: { input: ReturnType<typeof avatarInput>; label: string }) {
  const look = lookFor(input);
  return (
    <ReducedMotionOverride reduced={input.reducedMotion}>
      <Tile
        label={`${label} → ${look.name}${look.ghost ? " (ghost)" : ""}`}
        data-specimen="avatar"
        data-state={input.state}
        data-event={input.event ?? "none"}
        data-specimen-ghost={input.micMuted ? "true" : "false"}
        data-specimen-reduced={input.reducedMotion ? "true" : "false"}
      >
        <div className="w-36">
          <Stage reduced={input.reducedMotion}>
            <Avatar look={look} input={input} renderer={SvgGhost} />
          </Stage>
        </div>
      </Tile>
    </ReducedMotionOverride>
  );
}

export function AvatarSection() {
  return (
    <>
      {[false, true].map((reduced) => (
        <Section key={String(reduced)} id={`avatar-${reduced ? "reduced" : "full"}`} title={`Avatar, Reduced_Motion ${reduced ? "on" : "off"}`}>
          <Specimen input={avatarInput("connecting", null, { reduced, firstConnecting: true })} label="connecting, first of the Visit" />
          {STATES.flatMap((state) =>
            EVENTS.map((event) => <Specimen key={`${state}-${event}`} input={avatarInput(state, event, { reduced })} label={`${state} + ${event ?? "no event"}`} />),
          )}
          {STATES.map((state) => (
            <Specimen key={`ghost-${state}`} input={avatarInput(state, null, { reduced, ghost: true })} label={`${state}, mic muted`} />
          ))}
          <Specimen input={{ ...avatarInput("speaking", null, { reduced }), outputMuted: true }} label="speaking, output muted" />
        </Section>
      ))}
    </>
  );
}
