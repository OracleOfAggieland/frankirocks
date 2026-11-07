"use client";
// The Main_Screen with and without a Card (Brief 004 item 1). Each tile has a toggle, so the stage's
// glide between the centre and the left of the dock can be watched. The transform contains the
// Backdrop and the Card_Dock bottom sheet, both `fixed`, inside the tile.
import { initialVoiceState } from "@franki/core";
import { useState } from "react";
import { AuthPanel } from "../../../components/AuthPanel";
import { Avatar } from "../../../components/avatar/Avatar";
import { Stage } from "../../../components/avatar/Stage";
import { CallScreen } from "../../../components/CallScreen";
import { LiveRegion } from "../../../components/LiveRegion";
import { MainScreen } from "../../../components/screen/MainScreen";
import { SoundPreference, SoundToggle } from "../../../components/SoundToggle";
import { QUIET_BUTTON } from "../../../components/surfaces/classes";
import { TypedLine } from "../../../components/TypedLine";
import { lookFor } from "../../../ui/avatar/look";
import { useReducedMotion } from "../../../ui/hooks/reduced-motion";
import { CARDS, avatarInput } from "../_fixtures";
import { Section, Tile } from "./Section";

const noop = () => {};
const memory = new Map<string, string>();
const preference = new SoundPreference({ getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) });
const voice = initialVoiceState({ transcribeModel: "specimen" });

function ScreenSpecimen({ startWithCard }: { startWithCard: boolean }) {
  const [withCard, setWithCard] = useState(startWithCard);
  const reduced = useReducedMotion();
  const input = avatarInput("listening", null, { reduced });
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <button type="button" data-specimen-toggle="" className={QUIET_BUTTON} onClick={() => setWithCard((c) => !c)}>
        {withCard ? "Take the Card away" : "Bring a Card"}
      </button>
      <div data-specimen-screen={withCard ? "with-card" : "no-card"} className="relative flex min-h-[640px] w-full flex-col overflow-hidden rounded-card border border-stitch [transform:translateZ(0)]">
        <MainScreen
          signedIn
          reduced={reduced}
          paused={false}
          cards={withCard ? [CARDS[0]] : []}
          auth={<AuthPanel state={{ kind: "signedIn", email: "owner@example.com", uid: "specimen" }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} />}
          soundToggle={<SoundToggle preference={preference} />}
          stage={
            <Stage reduced={reduced}>
              <Avatar look={lookFor(input)} input={input} />
            </Stage>
          }
          controls={<CallScreen voice={voice} enabled onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />}
          typed={<TypedLine text="" enabled sending={false} canSend={false} error={null} onChange={noop} onSubmit={noop} />}
          live={<LiveRegion message={null} seq={0} />}
        />
      </div>
    </div>
  );
}

export function MainScreenSection() {
  return (
    <Section id="main-screen" title="Main screen with a Card">
      <div className="flex w-full flex-col gap-8">
        <Tile label="no Card: Franki centred; toggle to watch the glide" data-specimen="main-screen" data-start="no-card">
          <ScreenSpecimen startWithCard={false} />
        </Tile>
        <Tile label="with a Card: stage and dock from 1024 px, bottom sheet below" data-specimen="main-screen" data-start="with-card">
          <ScreenSpecimen startWithCard />
        </Tile>
      </div>
    </Section>
  );
}
