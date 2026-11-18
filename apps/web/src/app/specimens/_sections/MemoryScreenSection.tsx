"use client";
// The main screen on memory data (brief 020). The fixture answers of GET /api/memory go through the same view-model
// the main screen uses (`ui/memory-screen.ts`), so this is what /lab shows once the store holds these rows. The
// chip and the jar open the readout card; "Say gone" plays the false "gone" check's ask.
import { initialVoiceState } from "@franki/core";
import { useState } from "react";
import { MAIN_CHIPS } from "../../../client/memory-model";
import { AuthPanel } from "../../../components/AuthPanel";
import { Avatar } from "../../../components/avatar/Avatar";
import { Stage } from "../../../components/avatar/Stage";
import { CallScreen } from "../../../components/CallScreen";
import { LiveRegion } from "../../../components/LiveRegion";
import { MainScreen } from "../../../components/screen/MainScreen";
import { SoundPreference, SoundToggle } from "../../../components/SoundToggle";
import { Chips } from "../../../components/surfaces/Chips";
import { QUIET_BUTTON } from "../../../components/surfaces/classes";
import { Jar } from "../../../components/surfaces/Jar";
import { Lab } from "../../../components/surfaces/Lab";
import { Receipt } from "../../../components/surfaces/Receipt";
import { Strip } from "../../../components/surfaces/Strip";
import { TypedLine } from "../../../components/TypedLine";
import { lookFor } from "../../../ui/avatar/look";
import { useReducedMotion } from "../../../ui/hooks/reduced-motion";
import { goneAskCard, memorySurfaces, readoutCard } from "../../../ui/memory-screen";
import { FIXTURE_MEMORY } from "../_fixtures/memory";
import { avatarInput } from "../_fixtures";
import { Section, Tile } from "./Section";

const noop = () => {};
const stored = new Map<string, string>();
const preference = new SoundPreference({ getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => void stored.set(k, v) });
const voice = initialVoiceState({ transcribeModel: "specimen" });
const surfaces = memorySurfaces(FIXTURE_MEMORY);

function MemoryScreen() {
  const [readout, setReadout] = useState(false);
  const [gone, setGone] = useState(false);
  const reduced = useReducedMotion();
  const input = avatarInput("listening", null, { reduced });
  const cards = [...(gone ? [goneAskCard(() => setGone(false), noop)] : []), ...(readout ? [readoutCard([FIXTURE_MEMORY.overview.snapshot!], noop, () => setReadout(false))] : [])];
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <button type="button" data-specimen-toggle="gone" className={QUIET_BUTTON} onClick={() => setGone((g) => !g)}>
        {gone ? "Take the ask away" : "Say gone with no receipt"}
      </button>
      <div data-specimen-screen="memory" className="relative flex min-h-[760px] w-full flex-col overflow-hidden rounded-card border border-stitch [transform:translateZ(0)]">
        <MainScreen
          signedIn
          reduced={reduced}
          paused={false}
          cards={cards}
          auth={<AuthPanel state={{ kind: "signedIn", email: "owner@example.com", uid: "specimen" }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} onDeleteAccount={async () => false} />}
          soundToggle={<SoundToggle preference={preference} />}
          stage={
            <Stage reduced={reduced}>
              <Avatar look={lookFor(input)} input={input} />
            </Stage>
          }
          controls={<CallScreen voice={voice} enabled onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />}
          typed={<TypedLine text="" enabled sending={false} canSend={false} error={null} onChange={noop} onSubmit={noop} />}
          live={<LiveRegion message={null} seq={0} />}
          strip={surfaces.strip === null ? null : <Strip {...surfaces.strip} />}
          chips={<Chips chips={MAIN_CHIPS} disabled={false} onChip={() => setReadout((r) => !r)} />}
          jar={<Jar motes={surfaces.jar} onOpen={() => setReadout((r) => !r)} />}
          lab={<Lab counters={surfaces.lab?.counters ?? []} limits={surfaces.lab?.limits ?? []} receipt={surfaces.receipt === null ? null : <Receipt {...surfaces.receipt} />} />}
        />
      </div>
    </div>
  );
}

export function MemoryScreenSection() {
  return (
    <Section id="memory-screen" title="Main screen on memory data">
      <Tile label="fixture answers of the memory route, through the main screen's view-model" data-specimen="memory-screen">
        <MemoryScreen />
      </Tile>
    </Section>
  );
}
