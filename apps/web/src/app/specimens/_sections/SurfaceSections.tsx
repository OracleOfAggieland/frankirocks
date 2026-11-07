"use client";
// Every Surface in every state its props allow, with Fixture props (R20.1).
import { type VoiceState, initialVoiceState } from "@franki/core";
import { CallScreen } from "../../../components/CallScreen";
import { ReplyLine } from "../../../components/ReplyLine";
import { Captions } from "../../../components/surfaces/Captions";
import { Card } from "../../../components/surfaces/Card";
import { CardDock } from "../../../components/surfaces/CardDock";
import { Chips } from "../../../components/surfaces/Chips";
import { Jar } from "../../../components/surfaces/Jar";
import { Lab } from "../../../components/surfaces/Lab";
import { Receipt } from "../../../components/surfaces/Receipt";
import { Strip } from "../../../components/surfaces/Strip";
import { TimeBadge } from "../../../components/surfaces/TimeBadge";
import { WhatIKnowSheet } from "../../../components/surfaces/WhatIKnowSheet";
import { Wordmark } from "../../../components/surfaces/Wordmark";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import { clearTurnCopies } from "../../../ui/turn-copies";
import {
  CAPTION_LINE,
  CARDS,
  CHIPS,
  KNOWN_ITEMS,
  LAB,
  MOTES_ALL_KINDS,
  MOTES_OVER_CAP,
  RECEIPT,
  REPLY_ENTRIES,
  STRIP_FILLS,
  STRIP_RESULT,
  TIME_BADGE,
  TURN_COPIES,
} from "../_fixtures";
import { Section, Tile } from "./Section";

const noop = () => {};
const base = initialVoiceState({ transcribeModel: "specimen" });
const voice = (patch: Partial<VoiceState>): VoiceState => ({ ...base, ...patch });

const CALL_FORMS: { label: string; voice: VoiceState; enabled: boolean }[] = [
  { label: "start", voice: base, enabled: true },
  { label: "start, signed out", voice: base, enabled: false },
  { label: "start, hanging up", voice: voice({ hangingUp: true }), enabled: true },
  { label: "hang-up, listening", voice: voice({ phase: "LISTENING" }), enabled: true },
  { label: "hang-up, mic muted", voice: voice({ phase: "LISTENING", micMuted: true }), enabled: true },
  { label: "recovery with retry", voice: voice({ phase: "RECOVERY", recovery: { kind: "connection", since: 0, attempts: 3 }, retryVisible: true }), enabled: true },
  { label: "open failed", voice: voice({ error: "open" }), enabled: true },
];

export function SurfaceSections() {
  return (
    <ReducedMotionOverride reduced={false}>
      <Section id="cards" title="Cards">
        {CARDS.map((c) => (
          <Tile key={c.id} label={c.kind} data-specimen="card" data-kind={c.kind}>
            <Card {...c} />
          </Tile>
        ))}
        <Tile label="dock with three cards" data-specimen="dock">
          {/* The transform contains the dock's fixed bottom-sheet position inside this tile. */}
          <div className="relative min-h-80 w-[343px] [transform:translateZ(0)]">
            <CardDock cards={CARDS.slice(0, 3)} />
          </div>
        </Tile>
      </Section>
      <Section id="strip" title="Strip">
        {STRIP_FILLS.map((filled) => (
          <Tile key={filled} label={`filled ${filled}`} data-specimen="strip" data-fill={String(filled)}>
            <div className="w-xl max-w-full">
              <Strip open filled={filled} resultLabel={STRIP_RESULT} />
            </div>
          </Tile>
        ))}
        {[2, 5].map((filled) => (
          <Tile key={`narrow-${filled}`} label={`at 375 px (343 px content), filled ${filled}`} data-specimen="strip-375" data-fill={String(filled)}>
            <div className="w-[343px] rounded-card border border-stitch">
              <Strip open filled={filled as 2 | 5} resultLabel={STRIP_RESULT} />
            </div>
          </Tile>
        ))}
      </Section>
      <Section id="jar" title="Jar and What I know">
        <Tile label="every mote kind" data-specimen="jar">
          <Jar motes={MOTES_ALL_KINDS} onOpen={noop} />
        </Tile>
        <Tile label="over the cap" data-specimen="jar">
          <Jar motes={MOTES_OVER_CAP} onOpen={noop} />
        </Tile>
        <Tile label="What I know" data-specimen="sheet">
          <WhatIKnowSheet items={KNOWN_ITEMS} onWrong={noop} onForget={noop} onQuiet={noop} onClose={noop} />
        </Tile>
      </Section>
      <Section id="lab" title="Lab and Receipt">
        <Tile label="real counts and —" data-specimen="lab">
          <Lab {...LAB} />
        </Tile>
        <Tile label="receipt" data-specimen="receipt">
          <Receipt {...RECEIPT} />
        </Tile>
      </Section>
      <Section id="time" title="Time badge">
        <Tile label="simulated" data-specimen="time-badge">
          <TimeBadge {...TIME_BADGE} />
        </Tile>
      </Section>
      <Section id="captions" title="Captions and Chips">
        <Tile label="captions off" data-specimen="captions">
          <Captions on={false} line={CAPTION_LINE} onToggle={noop} />
        </Tile>
        <Tile label="captions on" data-specimen="captions">
          <Captions on line={CAPTION_LINE} onToggle={noop} />
        </Tile>
        <Tile label="chips" data-specimen="chips">
          <Chips chips={CHIPS} disabled={false} onChip={noop} />
        </Tile>
        <Tile label="chips disabled" data-specimen="chips">
          <Chips chips={CHIPS} disabled onChip={noop} />
        </Tile>
      </Section>
      <Section id="wordmark" title="Wordmarks">
        <Tile label="header" data-specimen="wordmark">
          <Wordmark variant="header" />
        </Tile>
        <Tile label="signed out" data-specimen="wordmark">
          <Wordmark variant="signedOut" />
        </Tile>
      </Section>
      <Section id="call" title="Call button">
        {CALL_FORMS.map((f) => (
          <Tile key={f.label} label={f.label} data-specimen="call">
            <CallScreen voice={f.voice} enabled={f.enabled} onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />
          </Tile>
        ))}
      </Section>
      <ForgetSection />
    </ReducedMotionOverride>
  );
}

/** The forget clear, before and after (R17.5). */
function ForgetSection() {
  const after = clearTurnCopies(TURN_COPIES);
  const views = [
    { label: "before forget", copies: TURN_COPIES, entries: REPLY_ENTRIES },
    { label: "after forget", copies: after, entries: [] },
  ];
  return (
    <Section id="forget" title="Forget clears every turn copy">
      {views.map((v) => (
        <Tile key={v.label} label={v.label} data-specimen="forget" data-phase={v.label}>
          <div className="flex w-[343px] flex-col items-center gap-3">
            <ReplyLine entries={v.entries} />
            <Captions on line={v.copies.caption} onToggle={noop} />
            {v.copies.cards.map((c) => (
              <Card key={c.id} {...c} />
            ))}
            <Jar motes={v.copies.jarItems.map((i) => ({ id: i.id, kind: i.hardRule ? "rule" : i.guessed ? "guessed" : "told" }))} onOpen={noop} />
          </div>
        </Tile>
      ))}
    </Section>
  );
}
