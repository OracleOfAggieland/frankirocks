"use client";
// Brief 015, package D: What I know as a modal sheet, a hard rule's two-tap removal with items
// dematerializing, motes arriving in and leaving the jar, and the strip stepping through a loop.
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { Jar } from "../../../components/surfaces/Jar";
import { Strip } from "../../../components/surfaces/Strip";
import { WhatIKnowSheet } from "../../../components/surfaces/WhatIKnowSheet";
import { QUIET_BUTTON } from "../../../components/surfaces/classes";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import type { MoteKind, StripProps } from "../../../ui/surface-props";
import { KNOWN_ITEMS, STRIP_RESULT } from "../_fixtures";
import { Section, Tile } from "./Section";

const LABELS = {
  section: "Strip, jar and What I know: in motion",
  openSheet: "Open as a sheet",
  sheet: "Sheet: a drawer from 1024 px, a bottom sheet below",
  twoTap: "A hard rule's Forget needs a second tap; forgotten items dematerialize",
  reset: "Put them back",
  narrow: (px: number) => `What I know at a ${px} px sheet: one row of actions`,
  jar: "Motes arriving and leaving",
  add: "Add a memory",
  forget: "Forget the newest",
  strip: "Strip, one terminal at a time",
  next: "Next terminal",
  calm: "Reduced motion",
} as const;

const noop = () => {};
const KINDS: MoteKind[] = ["told", "guessed", "rule", "private"];

function SheetTile() {
  const [open, setOpen] = useState(false);
  return (
    <Tile label={LABELS.sheet} data-specimen="sheet-modal">
      <button type="button" className={`${QUIET_BUTTON} text-sm`} onClick={() => setOpen(true)}>
        {LABELS.openSheet}
      </button>
      <AnimatePresence>
        {open ? <WhatIKnowSheet presentation="sheet" items={KNOWN_ITEMS} onWrong={noop} onForget={noop} onQuiet={noop} onClose={() => setOpen(false)} /> : null}
      </AnimatePresence>
    </Tile>
  );
}

function TwoTapTile() {
  const [items, setItems] = useState(KNOWN_ITEMS);
  return (
    <Tile label={LABELS.twoTap} data-specimen="sheet-two-tap">
      <WhatIKnowSheet items={items} onWrong={noop} onForget={(id) => setItems((list) => list.filter((i) => i.id !== id))} onQuiet={noop} onClose={noop} />
      <button type="button" className={`${QUIET_BUTTON} text-sm`} onClick={() => setItems(KNOWN_ITEMS)}>
        {LABELS.reset}
      </button>
    </Tile>
  );
}

/**
 * The sheet held at a set width, so its container query can be checked: 335 px (a phone, the front
 * door's stage) takes the tight action row, 400 px the full one. Its hard rule can be armed here.
 */
function NarrowSheetTile({ px }: { px: 335 | 400 }) {
  return (
    <Tile label={LABELS.narrow(px)} data-specimen={`sheet-${px}`}>
      <div className={px === 335 ? "w-[335px]" : "w-[400px]"}>
        <WhatIKnowSheet items={KNOWN_ITEMS} onWrong={noop} onForget={noop} onQuiet={noop} onClose={noop} />
      </div>
    </Tile>
  );
}

/** Leaving motes stay drawn (and unseen) until the next change, then drop out. */
function JarTile() {
  const [state, setState] = useState(() => ({
    next: 6,
    motes: Array.from({ length: 6 }, (_, i) => ({ id: `x-${i}`, kind: KINDS[i % 4] })),
    arriving: [] as string[],
    leaving: [] as string[],
  }));
  const settle = (s: typeof state) => ({ ...s, motes: s.motes.filter((m) => !s.leaving.includes(m.id)), leaving: [] as string[] });
  const add = () =>
    setState((s0) => {
      const s = settle(s0);
      const id = `x-${s.next}`;
      return { ...s, next: s.next + 1, motes: [...s.motes, { id, kind: KINDS[s.next % 4] }], arriving: [id] };
    });
  const forget = () =>
    setState((s0) => {
      const s = settle(s0);
      const last = s.motes.at(-1);
      return last ? { ...s, arriving: [], leaving: [last.id] } : s;
    });
  return (
    <Tile label={LABELS.jar} data-specimen="jar-motes">
      <Jar motes={state.motes} arrivingIds={state.arriving} leavingIds={state.leaving} onOpen={noop} />
      <div className="flex gap-2">
        <button type="button" className={`${QUIET_BUTTON} text-sm`} onClick={add}>
          {LABELS.add}
        </button>
        <button type="button" className={`${QUIET_BUTTON} text-sm`} onClick={forget}>
          {LABELS.forget}
        </button>
      </div>
    </Tile>
  );
}

function StripTile({ reduced }: { reduced: boolean }) {
  const [filled, setFilled] = useState<StripProps["filled"]>(1);
  const next = () => setFilled((f) => ((f + 1) % 6) as StripProps["filled"]);
  const body = (
    <div className="flex w-[343px] flex-col items-center gap-4 sm:w-[560px]">
      <Strip open filled={filled} resultLabel={STRIP_RESULT} />
      <button type="button" className={`${QUIET_BUTTON} text-sm`} onClick={next}>
        {LABELS.next}
      </button>
    </div>
  );
  return (
    <Tile label={reduced ? `${LABELS.strip} (${LABELS.calm})` : LABELS.strip} data-specimen="strip-stepper">
      {reduced ? (
        <div data-reduced="true">
          <ReducedMotionOverride reduced>{body}</ReducedMotionOverride>
        </div>
      ) : (
        body
      )}
    </Tile>
  );
}

export function MemoryExtrasSection() {
  return (
    <ReducedMotionOverride reduced={false}>
      <Section id="memory-extras" title={LABELS.section}>
        <SheetTile />
        <TwoTapTile />
        <NarrowSheetTile px={335} />
        <NarrowSheetTile px={400} />
        <JarTile />
        <StripTile reduced={false} />
        <StripTile reduced />
      </Section>
    </ReducedMotionOverride>
  );
}
