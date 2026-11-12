"use client";
// The visit, the time bolt and the sheet on fixture data (brief 027). Each tile draws the same components /lab
// mounts, from states of the real machine (`ui/visit/visit-machine.ts`) and rows made by the real `knownItems`
// from fixture answers of GET /api/memory. The live tile runs the machine with answers made up on the page; it
// sends nothing to any route.
import { useState } from "react";
import { TimeBadge } from "../../../components/surfaces/TimeBadge";
import { Receipt } from "../../../components/surfaces/Receipt";
import { VisitBar, type VisitBarProps } from "../../../components/surfaces/VisitBar";
import { WhatIKnowSheet } from "../../../components/surfaces/WhatIKnowSheet";
import { knownItems } from "../../../ui/known-items";
import { memorySurfaces } from "../../../ui/memory-screen";
import { boltTargets } from "../../../ui/visit/bolt-targets";
import { INITIAL_VISIT, type VisitEvent, type VisitState, boltEnabled, visitBadge, visitStep } from "../../../ui/visit/visit-machine";
import { FIXTURE_MEMORY, FIXTURE_SNAPSHOT, fixtureWhy } from "../_fixtures/memory";
import { CLONE_WORLD, PROACTIVE_ANSWER } from "../_fixtures/visit";
import { Section, Tile } from "./Section";

const noop = () => {};
const ZONE = "America/Chicago";
const WORLD = Date.parse(CLONE_WORLD);
/** A fixed "real" clock for the specimens: a week after the clone's world clock. */
const REAL = WORLD + 7 * 86_400_000;
const TARGETS = boltTargets(WORLD, ZONE);

const READY: VisitState = { ...INITIAL_VISIT, phase: "ready", visit: { visitId: "specimen", fixtureNamespace: "specimen-ns", worldClockMs: WORLD }, worldMs: WORLD, seq: 1 };

function bar(s: VisitState): VisitBarProps {
  return {
    phase: s.phase,
    failure: s.failure,
    bolt: s.bolt,
    boltFailed: s.boltFailed,
    confirming: s.confirming,
    endingCall: s.endingCall,
    targets: s.worldMs === null ? [] : boltTargets(s.worldMs, ZONE),
    boltEnabled: boltEnabled(s),
    onBolt: noop,
    onRetry: noop,
    onStartOver: noop,
    onConfirm: noop,
    onCancel: noop,
  };
}

const STATES: { label: string; state: VisitState }[] = [
  { label: "cloning", state: { ...INITIAL_VISIT, phase: "cloning" } },
  { label: "ready, bolt idle", state: READY },
  { label: "bolt moving", state: { ...READY, bolt: "moving" } },
  { label: "bolt waiting (barrier)", state: { ...READY, bolt: "waiting" } },
  { label: "bolt did not move", state: { ...READY, boltFailed: true } },
  { label: "start over, confirming", state: { ...READY, confirming: true } },
  { label: "resetting, ending the call", state: { ...READY, phase: "resetting", endingCall: true } },
  { label: "resetting", state: { ...READY, phase: "resetting" } },
  { label: "failed clone", state: { ...INITIAL_VISIT, phase: "failed", failure: "clone" } },
  { label: "failed, reload mid-clone", state: { ...INITIAL_VISIT, phase: "failed", failure: "interrupted" } },
  { label: "failed, barrier", state: { ...INITIAL_VISIT, phase: "failed", failure: "barrier" } },
];

const SHEET_ITEMS = knownItems([FIXTURE_SNAPSHOT], new Map(FIXTURE_SNAPSHOT.cards.map((c) => [c.id, fixtureWhy(c.id).items])));
const RECEIPT = memorySurfaces(FIXTURE_MEMORY).receipt;

/** The machine with answers made up on the page: a reset answers the clone's Friday, an advance answers its target. */
function LiveVisit() {
  const [s, setS] = useState<VisitState>(INITIAL_VISIT);
  const [line, setLine] = useState<string | null>(null);
  const feed = (state: VisitState, e: VisitEvent): VisitState => {
    const out = visitStep(state, e);
    let next = out.state;
    for (const c of out.commands) {
      if (c.kind === "reset") next = feed(next, { kind: "resetAnswered", seq: c.seq, fixtureNamespace: "specimen-ns", worldMs: WORLD });
      if (c.kind === "advance") next = feed(next, { kind: "advanceAnswered", seq: c.seq, worldMs: c.toMs, proactive: PROACTIVE_ANSWER });
      if (c.kind === "endCall") next = feed(next, { kind: "callEnded" });
      if (c.kind === "show") setLine(c.proactive.whisper.text);
      if (c.kind === "afterReset") setLine(null);
    }
    return next;
  };
  const send = (e: VisitEvent) => setS(feed(s, e));
  const badge = visitBadge(s, REAL, ZONE);
  return (
    <div data-specimen-visit="live" className="flex w-[343px] flex-col items-center gap-3 rounded-card border border-stitch p-4">
      <div className="min-h-8">
        <TimeBadge {...badge} />
      </div>
      {s.phase === "none" ? (
        <button type="button" className="text-sm text-brass underline" onClick={() => send({ kind: "entered", stored: null, newVisitId: "specimen" })}>
          Enter the lab
        </button>
      ) : (
        <VisitBar
          {...bar(s)}
          onBolt={(toMs) => send({ kind: "boltPressed", toMs })}
          onRetry={() => send({ kind: "retry", newVisitId: "specimen-retry" })}
          onStartOver={() => send({ kind: "startOverAsked" })}
          onConfirm={() => send({ kind: "startOverConfirmed", inCall: false, newVisitId: "specimen-again" })}
          onCancel={() => send({ kind: "startOverCancelled" })}
        />
      )}
      <p data-specimen-line="" className="min-h-6 text-sm text-ink">
        {line}
      </p>
    </div>
  );
}

export function VisitSection() {
  return (
    <Section id="visit" title="The visit, the time bolt and the sheet (brief 027)">
      <Tile label="live: the machine, answers made up on the page">
        <LiveVisit />
      </Tile>
      {STATES.map(({ label, state }) => (
        <Tile key={label} label={label} data-visit-specimen={label}>
          <div className="w-[343px]">
            <VisitBar {...bar(state)} />
          </div>
        </Tile>
      ))}
      <Tile label={`simulated: world ${TARGETS.length} targets from Friday 08:40`}>
        <TimeBadge {...visitBadge(READY, REAL, ZONE)} />
      </Tile>
      <Tile label="real time: no badge">
        <span data-specimen-badge="none" className="text-xs text-ink-dim">
          <TimeBadge {...visitBadge(INITIAL_VISIT, REAL, ZONE)} />
          (nothing drawn)
        </span>
      </Tile>
      <Tile label="What I know, read-only, on fixture rows">
        <WhatIKnowSheet items={SHEET_ITEMS} readOnly footer={RECEIPT === null ? null : <Receipt {...RECEIPT} />} onWrong={noop} onForget={noop} onQuiet={noop} onClose={noop} />
      </Tile>
    </Section>
  );
}
