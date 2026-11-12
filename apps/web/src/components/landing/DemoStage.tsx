"use client";
// The stage on the front door (brief 015, package H2): the real surfaces acting out the story on a sample month.
// The page hands it the step; ui/landing/stage-script.ts says what shows at that step, and this file places it.
//
// Layout is by container query on the stage box (stage.css). With nothing else showing, Franki is centred and
// large. With equipment showing, Franki settles left and smaller on spring.settle: the strip across the top, the
// source tags beside Franki, the cards on the right, the jar bottom left, the Lab bottom right. In a narrow box
// Franki moves up and the card or sheet rises over the lower half. A panel taller than its room is scaled down
// to fit it, the sheet further than the rest. Nothing here clips Franki, whose canvas spills past its box on every side.
//
// What works: Yes on the approval card, and the state toy. Everything else on the stage is inert. The stage is
// a section labelled for the demonstration, with no live region. On the server, and with scripting off, it shows
// Franki asleep and no sample data.
import { AnimatePresence, type Transition, motion } from "motion/react";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LANDING } from "../../ui/copy-landing";
import { usePageVisible } from "../../ui/hooks/page-visible";
import { planVoice, voiceWords } from "../../ui/landing/demo-voice";
import { KNOWN_ITEMS, KNOWN_MOTES, LAB_COUNTERS, SAMPLE_RECEIPT, SAMPLE_ROWS, SAMPLE_TAGS, type TagId, sampleCard } from "../../ui/landing/sample";
import { type StageScene, type StepClock, freshClock, layoutKey, stageFor, stepClock } from "../../ui/landing/stage-script";
import type { DemoStageProps, ToyState } from "../../ui/landing/steps";
import { DUR, EASE, SPRING, STAGGER } from "../../ui/motion";
import { CardDock } from "../surfaces/CardDock";
import { Jar } from "../surfaces/Jar";
import { Lab } from "../surfaces/Lab";
import { Receipt } from "../surfaces/Receipt";
import { Strip } from "../surfaces/Strip";
import { WhatIKnowSheet } from "../surfaces/WhatIKnowSheet";
import { DemoAvatar } from "./DemoAvatar";
import { StageFrame } from "./StageFrame";
import { StateToy } from "./StateToy";

/** Below this stage width, Franki moves up and panels rise over the lower half (stage.css agrees). */
export const NARROW_PX = 440;
/** A stage this tall, and not narrow, opens the rows behind the takeout card's bank tag. */
export const ROWS_MIN_HEIGHT_PX = 640;
/** The smallest a panel is scaled to fit its room. */
export const FIT_MIN = 0.72;
/** The smallest the "What I know" sheet is scaled from NARROW_PX: lower than the rest, so it shows whole, header included. */
export const SHEET_FIT_MIN = 0.6;

const noop = () => {};
const subscribeNothing = () => noop;

/** Pure. The scale that fits content of `natural` px into `room` px, never below `min`, in hundredths. */
export function fitScale(room: number, natural: number, min = FIT_MIN): number {
  if (!(room > 0) || !(natural > 0) || natural <= room) return 1;
  return Math.max(min, Math.floor((room / natural) * 100) / 100);
}

/** Pure. How the stage's box shapes the scene: a narrow stage, and whether the card's rows have room to open. */
export function boxFacts(box: { w: number; h: number } | null): { narrow: boolean; rows: boolean } {
  if (box === null) return { narrow: false, rows: false };
  const narrow = box.w < NARROW_PX;
  return { narrow, rows: !narrow && box.h >= ROWS_MIN_HEIGHT_PX };
}

const FADE: Transition = { duration: DUR.base / 1000, ease: [...EASE.ecto] as [number, number, number, number] };

/** Equipment rises 12 px into place and leaves rising 8 px, fading; a plain fade under reduced motion. No blur: glass keeps its blur. */
export function rise(reduced: boolean, delayMs = 0) {
  const delay = delayMs / 1000;
  if (reduced) return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { ...FADE, delay } as Transition };
  return {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
    transition: { y: { type: "spring", ...SPRING.settle, delay }, opacity: { ...FADE, delay } } as Transition,
  };
}

/** A panel scaled down to fit its slot when it is taller than the slot. */
function Fit({ min = FIT_MIN, className = "", children }: { min?: number; className?: string; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (o === null || i === null || typeof ResizeObserver === "undefined") return;
    const run = () => setScale(fitScale(o.clientHeight, i.offsetHeight, min));
    const observer = new ResizeObserver(run);
    observer.observe(o);
    observer.observe(i);
    run();
    return () => observer.disconnect();
  }, [min]);
  return (
    <div ref={outer} data-fit="" data-fit-min={min} className={`demo-fit ${className}`.trim()}>
      <div ref={inner} data-fit-scale={scale} className="demo-fit-inner" style={{ "--fit": scale } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

const TAG_GLYPH: Record<TagId, ReactNode> = {
  // A bank: a pediment over four columns on a step.
  bank: <path d="M2.2 6 8 2.6 13.8 6M3.4 6.8v5M6.5 6.8v5M9.5 6.8v5M12.6 6.8v5M2 13.4h12" />,
  // A calendar page with its two rings and a marked day.
  calendar: (
    <>
      <rect x="2.4" y="3.4" width="11.2" height="10.2" rx="1.6" />
      <path d="M2.4 6.6h11.2M5.4 2v2.6M10.6 2v2.6" />
      <path d="M9.4 9.2h2v2h-2z" />
    </>
  ),
};

/**
 * The stitched thread from the first tag's eyelet to the second's, in px. Each tag is 32 px tall with its eyelet
 * 14 px in; the second sits 30 px lower and 24 px further right (stage.css), so its eyelet is at (38, 78). The
 * thread leaves from under the first eyelet, turns, and ends at the second. Cross-ticks every 6 px.
 */
const WIRE_PATH = "M14 21 V66 Q14 78 26 78 H33";
const WIRE_TICKS = ["M11.5 28 h5", "M11.5 34 h5", "M11.5 40 h5", "M11.5 46 h5", "M11.5 52 h5", "M11.5 58 h5", "M29 75.5 v5"];

/** The source tags floating beside Franki, and at connected the stitched wire between them. */
function Tags({ tags, wire, reduced }: { tags: readonly TagId[]; wire: boolean; reduced: boolean }) {
  return (
    <div data-demo-tags="" className="relative">
      <AnimatePresence>
        {wire ? (
          <motion.span key="wire" aria-hidden="true" data-demo-wire="" className="demo-wire pointer-events-none absolute left-0 top-0 block" {...rise(reduced)}>
            <span className="demo-wire-window block">
              <svg focusable="false" viewBox="0 0 48 84" className="demo-wire-thread block h-[84px] w-12" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
                <path d={WIRE_PATH} />
                {WIRE_TICKS.map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
            </span>
          </motion.span>
        ) : null}
      </AnimatePresence>
      <ul className="relative flex flex-col items-start gap-[30px]">
        <AnimatePresence>
          {tags.map((id, i) => (
            <motion.li key={id} data-demo-tag={id} className={`demo-tag relative${i === 1 ? " demo-tag-second" : ""}`} {...rise(reduced, i * STAGGER)}>
              <span className="mat-glass relative inline-flex min-h-8 items-center gap-2 rounded-control py-1 pl-7 pr-3 font-mono text-xs text-ink">
                {/* The tag's eyelet, where the thread is tied. */}
                <span aria-hidden="true" className="demo-eyelet pointer-events-none absolute left-2.5 top-1/2 size-2 -translate-y-1/2 rounded-full" />
                <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" className="size-4 shrink-0 text-ink-dim" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  {TAG_GLYPH[id]}
                </svg>
                <span className="whitespace-nowrap">{SAMPLE_TAGS[id].label}</span>
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

/** The line Franki is saying: each word comes up to full strength as it is said; all at once under reduced motion. */
function SpokenLine({ text, spoken, reduced }: { text: string; spoken: number; reduced: boolean }) {
  const words = useMemo(() => voiceWords(text), [text]);
  return (
    <p data-demo-line="" className="demo-line text-sm leading-relaxed text-ink">
      {words.map((w, i) => (
        <span key={i} data-said={reduced || i < spoken ? "true" : "false"} className="demo-word">
          {w}{" "}
        </span>
      ))}
    </p>
  );
}

/** The width and height of an element, kept up to date. Null until measured. */
function useBox(ref: { current: HTMLElement | null }): { w: number; h: number } | null {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setBox((b) => (b !== null && b.w === w && b.h === h ? b : { w, h }));
    };
    const observer = new ResizeObserver(read);
    observer.observe(el);
    read();
    return () => observer.disconnect();
  }, [ref]);
  return box;
}

export interface StageViewProps {
  scene: StageScene;
  toy: ToyState;
  onToy: (next: ToyState) => void;
  onYes: () => void;
  reduced: boolean;
  /** Franki has woken. */
  awake: boolean;
  narrow: boolean;
  /** The takeout card's bank rows are open. */
  rows: boolean;
  /** Words of the line said so far. */
  spoken: number;
  /** Franki, placed by the view. */
  franki: ReactNode;
}

/** Every control in the dock but the approval card's Yes. */
const DOCK_OTHERS = "button:not([data-action='yes'])";

/** The stage's drawing for one scene. No timers and no browser reads, so it renders on the server and in tests. */
export function StageView(p: StageViewProps) {
  const { scene, reduced } = p;
  const dockSlot = useRef<HTMLDivElement>(null);
  const handlers = useMemo(() => ({ onYes: p.onYes, onNotNow: noop, onOpenSource: noop }), [p.onYes]);
  const cards = useMemo(() => scene.cards.map((id) => sampleCard(id, handlers)), [scene.cards, handlers]);
  const approving = scene.approval !== null;

  // Only Yes works on the stage: while the approval card is in front, every other control in the dock is inert.
  useEffect(() => {
    const slot = dockSlot.current;
    if (slot === null || !approving) return;
    const others = [...slot.querySelectorAll<HTMLElement>(DOCK_OTHERS)];
    for (const el of others) el.inert = true;
    return () => {
      for (const el of others) el.inert = false;
    };
  }, [approving, cards]);

  const items = KNOWN_ITEMS.filter((i) => i.id !== scene.forgotten);
  const leaving = scene.forgotten === null ? [] : [scene.forgotten];
  // A narrow stage has no room for the panel and the slip together: the slip prints on its own.
  const counters = scene.receipt && p.narrow ? [] : LAB_COUNTERS;
  const fig = scene.step === "hero" && !p.awake ? null : scene.fig;

  return (
    <div
      data-demo-layer=""
      data-layout={scene.layout}
      data-panel={scene.panel}
      data-strip={scene.strip.open ? "true" : "false"}
      data-tags={scene.tags.length > 0 ? "true" : "false"}
      data-jar={scene.jar ? "true" : "false"}
      data-lab={scene.lab ? "true" : "false"}
      data-line={scene.step === "suggested" ? "true" : "false"}
      data-plate={scene.plate ? "true" : "false"}
      className="demo-layer absolute inset-0"
    >
      <StageFrame frame={scene.frame} plate={scene.plate} fig={fig} />

      <motion.div
        data-demo-franki=""
        className="demo-franki absolute"
        layout={!reduced}
        layoutDependency={layoutKey(scene)}
        transition={{ layout: { type: "spring", ...SPRING.settle } }}
      >
        {p.franki}
      </motion.div>

      <div inert data-demo-slot="line" className="demo-slot-line absolute">
        <AnimatePresence>
          {scene.line !== null ? (
            <motion.div key="line" {...rise(reduced)}>
              <SpokenLine text={scene.line} spoken={p.spoken} reduced={reduced} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div inert data-demo-slot="strip" className="demo-slot-strip absolute">
        <AnimatePresence>
          {scene.strip.open ? (
            <motion.div key="strip" {...rise(reduced)}>
              <Strip {...scene.strip} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div inert data-demo-slot="tags" className="demo-slot-tags absolute">
        <Tags tags={scene.tags} wire={scene.wire} reduced={reduced} />
      </div>

      <div inert data-demo-slot="jar" className="demo-slot-jar absolute">
        <AnimatePresence>
          {scene.jar ? (
            <motion.div key="jar" {...rise(reduced)}>
              <Jar motes={[...KNOWN_MOTES]} onOpen={noop} arrivingIds={scene.step === "jar" ? KNOWN_MOTES.map((m) => m.id) : []} leavingIds={leaving} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div inert data-demo-slot="lab" className="demo-slot-lab absolute">
        <Fit>
          <AnimatePresence>
            {scene.lab ? (
              <motion.div key="lab" {...rise(reduced, STAGGER)}>
                <Lab counters={counters} limits={[]} receipt={scene.receipt ? <Receipt {...SAMPLE_RECEIPT} /> : null} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </Fit>
      </div>

      <div ref={dockSlot} inert={!approving} data-demo-slot="dock" className="demo-slot-panel demo-slot-dock absolute">
        {/* The approval card is never scaled, so Yes keeps its full target: it rises further over Franki instead. */}
        <Fit min={approving ? 1 : FIT_MIN}>
          <CardDock cards={cards} sourceRows={SAMPLE_ROWS} openSource={{ takeout: p.rows ? "bank" : null }} />
        </Fit>
      </div>

      <div inert data-demo-slot="sheet" className="demo-slot-panel demo-slot-sheet absolute">
        {/* Narrow, the sheet keeps the usual floor and fades at the top instead: smaller would not read on a phone. */}
        <Fit min={p.narrow ? FIT_MIN : SHEET_FIT_MIN} className="demo-window">
          <AnimatePresence>
            {scene.sheet ? (
              <motion.div key="sheet" {...rise(reduced)}>
                <WhatIKnowSheet items={items} onWrong={noop} onForget={noop} onQuiet={noop} onClose={noop} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </Fit>
      </div>

      {scene.toy ? (
        <div data-demo-slot="toy" className="demo-slot-toy absolute">
          <StateToy value={p.toy} onChange={p.onToy} />
        </div>
      ) : null}
    </div>
  );
}

export function DemoStage(props: DemoStageProps) {
  const { step, toy, onToy, onYes: pageYes, reduced } = props;
  const section = useRef<HTMLElement>(null);
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const visible = usePageVisible();
  const { narrow, rows } = boxFacts(useBox(section));

  // Each visit to a step is counted from its start: the entry goes up whenever the step changes, so coming back
  // to a step replays it from beat 0.
  const [visit, setVisit] = useState({ step, entry: 0 });
  const entry = visit.step === step ? visit.entry : visit.entry + 1;
  if (visit.step !== step) setVisit({ step, entry });

  const [awake, setAwake] = useState(false);
  const [counted, setCounted] = useState<StepClock>(() => freshClock(step, 0));
  // A beat and a word count belong to the visit they were counted in.
  const current = counted.step === step && counted.entry === entry;
  const beat = current ? counted.beat : 0;
  const spoken = current ? counted.spoken : 0;

  // On the server and the first paint: Franki asleep, no sample data.
  const scene = useMemo(() => stageFor(mounted ? step : "hero", toy, mounted ? beat : 0), [mounted, step, toy, beat]);
  const says = scene.line;
  const speaking = scene.franki.speaking;
  const speech = useMemo(() => (speaking && says !== null ? planVoice(says) : null), [speaking, says]);

  const clock = useRef<StepClock>(freshClock(step, 0));
  const woke = useRef(false);
  const latest = useRef({ step, entry, speech });
  useEffect(() => {
    latest.current = { step, entry, speech };
  });
  const onFrame = useCallback((at: number, isAwake: boolean) => {
    if (isAwake && !woke.current) {
      woke.current = true;
      setAwake(true);
    }
    if (!isAwake) return;
    const { step: now, entry: visitNo, speech: plan } = latest.current;
    const next = stepClock(clock.current, { step: now, entry: visitNo, at, plan });
    if (next !== clock.current) {
      clock.current = next;
      setCounted(next);
    }
  }, []);

  // Yes moves the page on, and the card it sat on leaves: focus comes to the stage first so it is not lost.
  const onYes = useCallback(() => {
    section.current?.focus({ preventScroll: true });
    pageYes();
  }, [pageYes]);

  return (
    <section
      ref={section}
      aria-label={LANDING.stage.label}
      data-demo-stage=""
      tabIndex={-1}
      data-step={scene.step}
      data-beat={scene.beat}
      data-reduced={reduced ? "true" : "false"}
      data-paused={visible ? "false" : "true"}
      className="demo-stage relative h-full min-h-0 w-full outline-none"
    >
      <StageView
        scene={scene}
        toy={toy}
        onToy={onToy}
        onYes={onYes}
        reduced={reduced}
        awake={awake}
        narrow={narrow}
        rows={rows}
        spoken={spoken}
        franki={<DemoAvatar franki={scene.franki} speech={speech} reduced={reduced} onFrame={onFrame} />}
      />
    </section>
  );
}
