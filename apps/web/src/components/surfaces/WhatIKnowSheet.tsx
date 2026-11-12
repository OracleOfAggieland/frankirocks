"use client";
// The What_I_Know_Sheet (lab-ui-foundation R16.1, R16.4, R16.12). Hard rules first under their seal,
// then the five areas in order. Each item shows its text, where it came from, and Wrong, Forget and
// Don't bring it up. Guesses are labelled "Guessed" with a dashed outline. Renders nothing when empty.
// Brief 015: each group has a line glyph and a seam; each item is a specimen tag; a hard rule's Forget
// needs a second tap (the first turns its label into "Tap again" at the same size, shows and announces
// "Tap again to remove this rule" under the row, until it loses focus or a press lands elsewhere). The
// sheet is a container (`@container/sheet`, with a set width inline so it never sizes to its contents),
// and its action row tightens below 400 px of sheet width; items leave by dematerializing and the rest glide up on
// spring.settle. `presentation="sheet"` makes it modal: focus moves to the heading on
// open and back on close, stays inside, and Escape closes. From 1024 px a drawer on the right (at most
// 420 px), below that a bottom sheet (at most 80svh, scrolling inside). Enter and leave it inside an
// AnimatePresence so it can rise in and sink out.
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { type KeyboardEvent, type ReactNode, type Ref, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, EASE, SPRING } from "../../ui/motion";
import type { Area, KnownItem, WhatIKnowProps } from "../../ui/surface-props";
import { materializeTransition, materializeVariants } from "../motion/Materialize";
import { FOCUS, QUIET_BUTTON, TARGET } from "./classes";
import { Seal } from "./Seal";
import { Seam } from "./Seam";

export type SheetPresentation = "inline" | "sheet";

export type WhatIKnowSheetProps = WhatIKnowProps & {
  /** "inline" (the default) sits in the page; "sheet" is modal: a drawer from 1024 px, a bottom sheet below. */
  presentation?: SheetPresentation;
};

// ---- Pure rules, tested in WhatIKnowSheet.test.tsx ----

/**
 * The order items are shown in: hard rules first, then each area that has items, in COPY.areas order, then the
 * items no view has given an area yet (`area: null`, brief 027), under "Other things".
 */
export function sheetGroups(items: readonly KnownItem[]): { rules: KnownItem[]; groups: { area: Area | null; items: KnownItem[] }[] } {
  const rules = items.filter((i) => i.hardRule);
  const areas: (Area | null)[] = [...COPY.areas, null];
  const groups = areas.map((area) => ({ area, items: items.filter((i) => !i.hardRule && (i.area ?? null) === area) })).filter((g) => g.items.length > 0);
  return { rules, groups };
}

/** Every item ID in the order the sheet shows them. */
export function sheetOrder(items: readonly KnownItem[]): string[] {
  const { rules, groups } = sheetGroups(items);
  return [...rules, ...groups.flatMap((g) => g.items)].map((i) => i.id);
}

/**
 * A press on a hard rule's Forget. The first press arms it (the label asks for a second tap); a press
 * on the armed rule forgets it. Arming one rule disarms any other.
 */
export function ruleForgetPress(armed: string | null, id: string): { armed: string | null; forget: boolean } {
  return armed === id ? { armed: null, forget: true } : { armed: id, forget: false };
}

/** A rule's Forget lost focus: it disarms, unless a different rule is the armed one. */
export function ruleForgetBlur(armed: string | null, id: string): string | null {
  return armed === id ? null : armed;
}

/**
 * Where focus goes when an item is forgotten from under it: the next item, else the one before, else
 * nothing left (null: the heading takes it).
 */
export function focusAfterForget(order: readonly string[], id: string): string | null {
  const at = order.indexOf(id);
  if (at < 0) return null;
  return order[at + 1] ?? order[at - 1] ?? null;
}

/** Whether forgetting `id` closes the sheet: only as a modal sheet, and only when it is the last item. */
export function closesOnForget(presentation: SheetPresentation, order: readonly string[], id: string): boolean {
  return presentation === "sheet" && order.length === 1 && order[0] === id;
}

/**
 * Tab inside the sheet. `current` is the focused control's index among the `count` controls, or -1
 * when focus is on the heading or outside. Returns the index to focus, wrapping at both ends, or -1
 * when there is no control (the heading keeps focus).
 */
export function nextFocusIndex({ count, current, shift }: { count: number; current: number; shift: boolean }): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return shift ? count - 1 : 0;
  return shift ? (current - 1 + count) % count : (current + 1) % count;
}

/** The controls Tab moves between inside the sheet. */
export const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ---- Drawing ----

/**
 * The three actions fit one row from a 335 px sheet. Below 400 px of sheet width (a container query on
 * the sheet, which can be narrow inside a wide page) the labels drop to 12 px with tighter padding and
 * gap; from 400 px they take 14 px. Worst row at 335 px: a modal sheet's body is 335 - 40 (px-5) = 295,
 * an item's inside is 295 - 32 (pl-8) - 12 (pr-3) - 2 (border) = 249. Narrow buttons are their text
 * plus 14 (px-1.5 and border): Wrong about 50, a rule's Forget held at "Tap again" about 71, Don't bring
 * it up about 101, two 6 px gaps: about 234, 15 to spare. Each stays at least 44 px tall and wide.
 */
const ACTION_BODY = `${TARGET} ${FOCUS} rounded-control border px-1.5 text-xs @min-[25rem]/sheet:px-3 @min-[25rem]/sheet:text-sm transition-colors duration-(--dur-quick) hover:bg-night-2`;
/** The action row: one row from a 335 px sheet; it still wraps if a sheet is ever narrower. */
const ACTION_ROW = "mt-1 flex flex-wrap gap-1.5 @min-[25rem]/sheet:gap-2";
const ACTION = `inline-flex items-center justify-center ${ACTION_BODY}`;
/** A hard rule's Forget: both labels share one grid cell, so arming never changes the row's layout. */
const ACTION_FIXED = `inline-grid place-items-center text-center ${ACTION_BODY}`;

const fade = { duration: DUR.base / 1000, ease: [...EASE.ecto] as [number, number, number, number] };

/** Forgotten items' neighbours and the groups below them glide into the gap on spring.settle. */
const glide = { type: "spring" as const, ...SPRING.settle };

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" data-glyph="" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/** One line glyph per area. */
const AREA_GLYPH: Record<Area, ReactNode> = {
  // A clock face with two hands.
  "Time and work": (
    <>
      <circle cx={8} cy={8} r={5.75} />
      <path d="M8 4.75 V8 L10.4 9.6" />
    </>
  ),
  // A fork: three tines, the bowl, the handle.
  "Food and health": <path d="M5.25 2.5 V6.25 M8 2.5 V6.25 M10.75 2.5 V6.25 M5.25 6.25 Q5.25 9 8 9 Q10.75 9 10.75 6.25 M8 9 V13.75" />,
  // A banknote with its centre medallion.
  Money: (
    <>
      <rect x={1.75} y={4.25} width={12.5} height={7.5} rx={1.25} />
      <circle cx={8} cy={8} r={1.9} />
      <path d="M4 6.4 V9.6 M12 6.4 V9.6" />
    </>
  ),
  // Two people, one a little behind the other.
  People: (
    <>
      <circle cx={6} cy={5.5} r={2.1} />
      <path d="M2.25 13.25 Q2.25 9.25 6 9.25 Q9.75 9.25 9.75 13.25" />
      <circle cx={11.25} cy={6.1} r={1.7} />
      <path d="M10.9 9.4 Q13.75 9.5 13.75 12.75" />
    </>
  ),
  // A flag on a pole.
  Goals: <path d="M4 13.75 V2.5 M4 3 H12.25 L10.25 5.6 L12.25 8.2 H4" />,
};

/** Items no view has sorted yet: three loose dots. */
const UNSORTED_GLYPH: ReactNode = (
  <>
    <circle cx={4} cy={8} r={1.25} />
    <circle cx={8} cy={8} r={1.25} />
    <circle cx={12} cy={8} r={1.25} />
  </>
);

type ItemActions = Pick<WhatIKnowProps, "onWrong" | "onQuiet"> & { forget: (item: KnownItem, el: HTMLElement | null) => void; onRuleBlur: (id: string) => void; readOnly: boolean };

/** One item: a specimen tag with an eyelet, its text, where it came from, then the three quiet actions. */
function itemTag(item: KnownItem, armed: string | null, reduced: boolean, a: ItemActions) {
  const isArmed = item.hardRule && armed === item.id;
  return (
    <motion.li
      key={item.id}
      data-item={item.id}
      data-guessed={item.guessed ? "true" : "false"}
      className={`relative flex flex-col gap-1 rounded-control py-3 pr-3 pl-8 ${item.guessed ? "border border-dashed border-ink-dim" : "border border-ink/10 bg-night-1/80"}`}
      layout={reduced ? false : "position"}
      variants={materializeVariants(reduced)}
      initial="hidden"
      animate="shown"
      exit="gone"
      transition={{ ...materializeTransition(reduced, "settle"), layout: glide }}
    >
      {/* The tag's eyelet: a punched hole on a short thread. */}
      <span aria-hidden="true" className="pointer-events-none absolute top-[19px] left-3 size-2 rounded-full border border-ink-dim/70 bg-night-0" />
      <span aria-hidden="true" className="pointer-events-none absolute top-[22px] left-0 h-px w-3 bg-stitch" />
      <div className="flex items-start gap-2">
        {item.hardRule ? <Seal /> : null}
        <p className="min-w-0 text-base text-ink">{item.text}</p>
        {item.guessed ? <span className="ml-auto shrink-0 rounded-chip border border-dashed border-ink-dim px-2 py-0.5 font-mono text-xs text-ink-dim">{COPY.sheet.guessed}</span> : null}
      </div>
      <p className="font-mono text-xs text-ink-dim">
        {COPY.sheet.from} {item.from}
      </p>
      {a.readOnly ? null : (
      <div data-actions="" className={ACTION_ROW}>
        <button type="button" data-action="wrong" className={`${ACTION} border-ink-dim/70 text-ink`} onClick={() => a.onWrong(item.id)}>
          {COPY.sheet.wrong}
        </button>
        <button
          type="button"
          data-action="forget"
          data-armed={item.hardRule ? (isArmed ? "true" : "false") : undefined}
          // Armed: a doubled ember edge (an inset ring, so no size change) and a new label, not colour alone.
          className={`${item.hardRule ? ACTION_FIXED : ACTION} ${isArmed ? "border-ember text-ink ring-1 ring-inset ring-ember" : "border-ink-dim/70 text-ink"}`}
          onClick={(e) => a.forget(item, e?.currentTarget ?? null)}
          onBlur={item.hardRule ? () => a.onRuleBlur(item.id) : undefined}
        >
          {item.hardRule ? (
            <>
              <span className="col-start-1 row-start-1">{isArmed ? COPY.sheet.armedRule : COPY.sheet.forget}</span>
              {/* The other label, unseen, holds the button at the wider of the two widths. */}
              <span aria-hidden="true" data-label={isArmed ? COPY.sheet.forget : COPY.sheet.armedRule} className="franki-sheet-label-spacer col-start-1 row-start-1" />
            </>
          ) : (
            COPY.sheet.forget
          )}
        </button>
        <button type="button" data-action="quiet" className={`${ACTION} border-ink-dim/70 text-ink`} onClick={() => a.onQuiet(item.id)}>
          {COPY.sheet.quiet}
        </button>
      </div>
      )}
      {/* The whole warning, in words, while the rule waits for its second tap. The sheet's status
          region announces it, so this visible copy is hidden from assistive tech to avoid a double read. */}
      {isArmed ? (
        <p aria-hidden="true" data-rule-confirm="" className="franki-sheet-confirm flex items-center gap-1.5 text-xs whitespace-nowrap text-ink">
          <span className="size-1.5 shrink-0 rounded-full bg-ember" />
          {COPY.sheet.confirmRule}
        </p>
      ) : null}
    </motion.li>
  );
}

function groupHead(glyph: ReactNode, label: string, tone: "brass" | "dim") {
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      <h3 className={`flex items-center gap-2 text-sm ${tone === "brass" ? "text-brass" : "text-ink-dim"}`}>
        {glyph}
        {label}
      </h3>
      <Seam />
    </div>
  );
}

export interface WhatIKnowViewProps extends WhatIKnowProps {
  presentation: SheetPresentation;
  reduced: boolean;
  /** The hard rule whose Forget is waiting for its second tap. */
  armed: string | null;
  onArm: (id: string) => void;
  onRuleBlur: (id: string) => void;
  /** Called with the pressed button just before a forget goes out, so focus can move on first. */
  onBeforeForget?: (id: string, el: HTMLElement | null) => void;
  headingRef?: Ref<HTMLHeadingElement>;
  panelRef?: Ref<HTMLElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

/** The sheet's drawing, with no state of its own. */
export function WhatIKnowView({ headingRef, panelRef, onKeyDown, onClose, ...p }: WhatIKnowViewProps) {
  const { items, presentation, reduced, armed } = p;
  if (items.length === 0) return null;
  const { rules, groups } = sheetGroups(items);
  const actions: ItemActions = {
    onWrong: p.onWrong,
    onQuiet: p.onQuiet,
    onRuleBlur: p.onRuleBlur,
    readOnly: p.readOnly === true,
    forget: (item, el) => {
      if (item.hardRule && !ruleForgetPress(armed, item.id).forget) {
        // Some browsers don't focus a clicked button; focusing it here gives every browser a blur to disarm on.
        el?.focus({ preventScroll: true });
        p.onArm(item.id);
        return;
      }
      p.onBeforeForget?.(item.id, el);
      p.onForget(item.id);
    },
  };
  const sheet = presentation === "sheet";
  const head = (
    <div className={`flex items-center justify-between gap-3 ${sheet ? "px-5 pt-3" : ""}`}>
      <h2 ref={headingRef} tabIndex={-1} className="text-lg text-ink outline-none">
        {COPY.sheet.title}
      </h2>
      <button type="button" data-action="close" className={`${QUIET_BUTTON} text-sm`} onClick={onClose}>
        {COPY.sheet.close}
      </button>
    </div>
  );
  const body = (
    <div data-sheet-body="" className={`flex flex-col gap-5 ${sheet ? "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]" : ""}`}>
      <AnimatePresence initial={false}>
        {rules.length > 0 ? (
          <motion.div
            key="rules"
            data-group="rules"
            layout={reduced ? false : "position"}
            variants={materializeVariants(reduced)}
            initial="hidden"
            animate="shown"
            exit="gone"
            transition={{ ...materializeTransition(reduced), layout: glide }}
          >
            {groupHead(<Seal />, COPY.sheet.hardRules, "brass")}
            <ul className="relative flex flex-col gap-2">
              <AnimatePresence initial={false} mode="popLayout">
                {rules.map((i) => itemTag(i, armed, reduced, actions))}
              </AnimatePresence>
            </ul>
          </motion.div>
        ) : null}
        {groups.map((g) => (
          <motion.div
            key={g.area ?? "unsorted"}
            data-group={g.area ?? "unsorted"}
            layout={reduced ? false : "position"}
            variants={materializeVariants(reduced)}
            initial="hidden"
            animate="shown"
            exit="gone"
            transition={{ ...materializeTransition(reduced), layout: glide }}
          >
            {groupHead(<Glyph>{g.area === null ? UNSORTED_GLYPH : AREA_GLYPH[g.area]}</Glyph>, g.area ?? COPY.sheetData.unsorted, "dim")}
            <ul className="relative flex flex-col gap-2">
              <AnimatePresence initial={false} mode="popLayout">
                {g.items.map((i) => itemTag(i, armed, reduced, actions))}
              </AnimatePresence>
            </ul>
          </motion.div>
        ))}
      </AnimatePresence>
      {p.footer ? <div data-sheet-footer="">{p.footer}</div> : null}
    </div>
  );
  // Announces the second-tap warning, since a changed label on the focused button is not reliably read out.
  const status = (
    <span role="status" data-rule-status="" className="sr-only">
      {armed !== null && rules.some((r) => r.id === armed) ? COPY.sheet.confirmRule : ""}
    </span>
  );
  if (!sheet) {
    return (
      <section role="dialog" aria-label={COPY.sheet.title} data-sheet="" className="mat-glass @container/sheet flex w-[343px] max-w-full flex-col gap-4 rounded-card p-4 text-left sm:w-md">
        {head}
        {status}
        {body}
      </section>
    );
  }
  return (
    <motion.section
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={COPY.sheet.title}
      data-sheet=""
      data-presentation="sheet"
      // Focusable by script and by a click inside, so focus never falls out to the page from within.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="mat-glass @container/sheet absolute outline-none inset-x-0 bottom-0 flex max-h-[80svh] flex-col rounded-t-card text-left lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-full lg:max-w-[420px] lg:rounded-none lg:rounded-l-card"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
      transition={reduced ? fade : { y: { type: "spring", ...SPRING.settle }, opacity: fade }}
    >
      <div className="px-5 pt-4">
        <Seam />
      </div>
      {head}
      {status}
      {body}
    </motion.section>
  );
}

/** The modal layer: a scrim and the panel, with focus moved in, held in, and handed back. */
function SheetLayer(props: Omit<WhatIKnowViewProps, "presentation" | "headingRef" | "panelRef" | "onKeyDown">) {
  const { onClose, reduced } = props;
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const holding = useRef(false);

  const handBack = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    const el = returnTo.current;
    returnTo.current = null;
    if (el && el.isConnected) el.focus({ preventScroll: true });
  }, []);

  // While the sheet is present (not while it sinks out), hold focus in it. If it becomes present
  // again before its exit ends, the hold starts again.
  const present = useIsPresent();

  const close = useCallback(() => {
    handBack();
    onClose();
  }, [handBack, onClose]);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    if (!present) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    holding.current = true;
    heading.current?.focus({ preventScroll: true });
    const guard = (e: FocusEvent) => {
      const p = panel.current;
      if (holding.current && p && e.target instanceof Node && !p.contains(e.target)) heading.current?.focus({ preventScroll: true });
    };
    // Escape and Tab are read on the document, so they work wherever focus sits, even on the page body.
    const keys = (e: globalThis.KeyboardEvent) => {
      if (!holding.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      const p = panel.current;
      if (e.key !== "Tab" || !p) return;
      const controls = [...p.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      const next = nextFocusIndex({ count: controls.length, current: controls.indexOf(document.activeElement as HTMLElement), shift: e.shiftKey });
      e.preventDefault();
      (next < 0 ? heading.current : controls[next])?.focus();
    };
    document.addEventListener("focusin", guard);
    document.addEventListener("keydown", keys, true);
    return () => {
      document.removeEventListener("focusin", guard);
      document.removeEventListener("keydown", keys, true);
      handBack();
    };
  }, [present, handBack]);

  return (
    <div data-sheet-layer="" className="fixed inset-0 z-50">
      <motion.div
        aria-hidden="true"
        data-sheet-scrim=""
        className="absolute inset-0 bg-night-0/60"
        onClick={close}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={fade}
      />
      <WhatIKnowView {...props} reduced={reduced} onClose={close} presentation="sheet" headingRef={heading} panelRef={panel} />
    </div>
  );
}

export function WhatIKnowSheet({ presentation = "inline", ...props }: WhatIKnowSheetProps) {
  const reduced = useReducedMotion();
  const [armed, setArmed] = useState<string | null>(null);
  const order = useMemo(() => sheetOrder(props.items), [props.items]);
  const { onForget, onClose } = props;

  const onArm = useCallback((id: string) => setArmed((a) => ruleForgetPress(a, id).armed), []);
  const onRuleBlur = useCallback((id: string) => setArmed((a) => ruleForgetBlur(a, id)), []);

  // A press anywhere but the armed button disarms it, for touch browsers that don't blur on a tap.
  useEffect(() => {
    if (armed === null) return;
    const press = (e: PointerEvent) => {
      const button = e.target instanceof Element ? e.target.closest('[data-action="forget"]') : null;
      if (button?.closest("[data-item]")?.getAttribute("data-item") === armed) return;
      onRuleBlur(armed);
    };
    document.addEventListener("pointerdown", press, true);
    return () => document.removeEventListener("pointerdown", press, true);
  }, [armed, onRuleBlur]);

  const forget = useCallback(
    (id: string) => {
      setArmed(null);
      onForget(id);
      // The last item gone: the sheet closes, so it sinks out with that item still drawn.
      if (closesOnForget(presentation, order, id)) onClose();
    },
    [onForget, onClose, presentation, order],
  );
  // Before an item goes, focus moves to its neighbour's first action, or to the heading when none is left.
  const onBeforeForget = useCallback(
    (id: string, el: HTMLElement | null) => {
      const root = el?.closest("[data-sheet]");
      if (!root) return;
      const next = focusAfterForget(order, id);
      const target = next === null ? root.querySelector<HTMLElement>("h2") : root.querySelector<HTMLElement>(`[data-item="${CSS.escape(next)}"] button`);
      target?.focus({ preventScroll: true });
    },
    [order],
  );

  if (props.items.length === 0) return null;
  const shared = { ...props, onForget: forget, reduced, armed, onArm, onRuleBlur, onBeforeForget };
  return presentation === "sheet" ? <SheetLayer {...shared} /> : <WhatIKnowView {...shared} presentation="inline" />;
}
