"use client";
// Brief 044: what a call puts on the screen. The cards a tool answer brings, in the Card_Dock beside the call
// controls (item 1), and the company toggle driven by a stand-in server that answers only when asked (item 3), so
// the toggle can be seen showing what the server last confirmed and never its own guess. No route is called.
import { type Card, type VoiceState, initialVoiceState } from "@franki/core";
import { useState } from "react";
import { CallScreen } from "../../../components/CallScreen";
import { CardDock } from "../../../components/surfaces/CardDock";
import { QUIET_BUTTON } from "../../../components/surfaces/classes";
import { CompanyToggle } from "../../../components/surfaces/CompanyToggle";
import { callCardProps } from "../../../ui/call-cards";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import { Section, Tile } from "./Section";

const noop = () => {};
const ID = (c: string) => c.repeat(43);
const listening: VoiceState = { ...initialVoiceState({ transcribeModel: "specimen" }), phase: "LISTENING" };

/** The hero's two cards as a tool answer brings them (specimen words, not seed data). */
const HERO_CARDS: Card[] = [
  { id: ID("d"), kind: "food", title: "Three quick dinners", lines: ["Tuesday: sheet-pan chicken", "Wednesday: black bean tacos", "Thursday: pesto pasta"], sources: [], sens: "S0" },
  { id: ID("g"), kind: "food", title: "Grocery list", lines: ["Chicken thighs", "Black beans", "Tortillas", "Pesto"], sources: [], sens: "S0" },
];
const SHOWN = { key: ID("t"), sessionId: ID("s"), generation: 1, cards: HERO_CARDS };
/** A card whose words came from a source with markup in it: the Card shows the text, never the markup. */
const MARKUP: Card[] = [{ id: ID("m"), kind: "memory", title: "<b>Bold</b> & <i>fancy</i>", lines: ["<script>alert(1)</script>"], sources: [], sens: "S0" }];

/** The toggle over a stand-in server: a press waits, "Server answers" confirms it, "Server refuses" keeps it. */
function TapAgainstServer() {
  const [company, setCompany] = useState(false);
  const [asked, setAsked] = useState<boolean | null>(null);
  return (
    <div className="flex flex-col items-center gap-2">
      <CompanyToggle company={company} disabled={asked !== null} onChange={(next) => setAsked(next)} />
      <div className="flex gap-2">
        <button type="button" disabled={asked === null} className={QUIET_BUTTON} onClick={() => (setCompany(asked ?? company), setAsked(null))}>
          Server answers
        </button>
        <button type="button" disabled={asked === null} className={QUIET_BUTTON} onClick={() => setAsked(null)}>
          Server refuses
        </button>
      </div>
    </div>
  );
}

export function CallScreenSection() {
  return (
    <ReducedMotionOverride reduced={false}>
      <Section id="call-screen" title="A call on the screen">
        <Tile label="Cards from a tool answer, during a call" data-specimen="call-cards">
          <div className="flex w-[343px] flex-col items-center gap-4">
            <CallScreen voice={listening} enabled onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />
            <div className="w-full [&_aside]:static [&_aside]:px-0 [&_aside]:pb-0">
              <CardDock cards={callCardProps(SHOWN)} />
            </div>
          </div>
        </Tile>
        <Tile label="A card's markup shows as text" data-specimen="call-cards-markup">
          <div className="w-[343px] [&_aside]:static [&_aside]:px-0 [&_aside]:pb-0">
            <CardDock cards={callCardProps({ ...SHOWN, cards: MARKUP })} />
          </div>
        </Tile>
        <Tile label="Company toggle: press it, then the server answers or refuses" data-specimen="company-tap">
          <TapAgainstServer />
        </Tile>
        <Tile label="Company toggle while the visit is cloning or failed" data-specimen="company-gated">
          <CompanyToggle company={false} disabled onChange={noop} />
        </Tile>
      </Section>
    </ReducedMotionOverride>
  );
}
