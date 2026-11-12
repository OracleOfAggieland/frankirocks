"use client";
// The Card_Dock (lab-ui-foundation R12.2, R15.6, R15.7, R16.12; brief 015). One primary Card; up to two older
// ones stacked behind it at 96% and 92%. A right column at 1024 px and wider, a bottom sheet below.
// A Card enters from Franki's side by materializing (from 24 px toward the stage, rising 12 px, fading in) and
// leaves by dematerializing (rising 8 px, fading, blurring to 6 px), on spring.settle. The last card leaves with
// the dock around it. Under reduced motion both are plain fades.
// The enter has no blur: a resting filter, even blur(0px), would cut the card's glass off from what is behind
// it, so the glass would stop blurring the lab. A leaving card may blur, since it is going.
// Older cards show only their edges: each is an empty glass shell the size of the primary Card,
// lifted so its top edge peeks out above it. No text from an older card is drawn, and the shells are
// inert and hidden from assistive tech.
// A leaving card, and the dock as it leaves, are inert and hidden from assistive tech for the whole exit.
// The host learns that the last card has gone through onExitComplete.
import { AnimatePresence, type Transition, motion, useIsPresent } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, EASE, SPRING } from "../../ui/motion";
import type { CardProps } from "../../ui/surface-props";
import { Card, type CardExtras, type SourceRowsBySource, cardHasContent } from "./Card";

export const STACK_SCALES = [1, 0.96, 0.92] as const;
/** How far each older card's top edge peeks out above the one in front, in px. */
export const STACK_PEEK = 8;
const STACK_OPACITY = [1, 0.75, 0.5] as const;
/** How far toward Franki a card starts, in px: the stage is to the dock's left. */
const FROM_FRANKI = -24;

const FADE: Transition = { duration: DUR.base / 1000, ease: [...EASE.ecto] as [number, number, number, number] };

/** Pure. Where a card at this depth rests in the stack. */
export function stackPose(depth: number) {
  return { opacity: STACK_OPACITY[depth], x: 0, y: depth * -STACK_PEEK, scale: STACK_SCALES[depth] };
}

/** Pure. The materialize, rest and dematerialize poses for a card at this depth. */
export function dockMotion(depth: number, reduced: boolean) {
  const rest = stackPose(depth);
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: rest.opacity, x: 0, y: rest.y, scale: rest.scale },
      exit: { opacity: 0 },
      transition: FADE,
    };
  }
  return {
    initial: { opacity: 0, x: FROM_FRANKI, y: 12, scale: rest.scale },
    animate: rest,
    exit: { opacity: 0, y: rest.y - 8, filter: "blur(6px)" },
    transition: { x: { type: "spring", ...SPRING.settle }, y: { type: "spring", ...SPRING.settle }, scale: { type: "spring", ...SPRING.settle }, opacity: FADE, filter: FADE } as Transition,
  };
}

/**
 * Pure. What a wrapper carries while its card (or the dock) is leaving: inert and hidden, so a card already
 * answered or withdrawn takes no tap or focus while it fades, and the card coming in front can be reached.
 */
export function leavingProps(isPresent: boolean): { inert?: true; "aria-hidden"?: true; "data-leaving"?: "" } {
  return isPresent ? {} : { inert: true, "aria-hidden": true, "data-leaving": "" };
}

/** A wrapper that goes inert once the AnimatePresence around it starts its exit. */
function UntilLeaving({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  const isPresent = useIsPresent();
  return (
    <div className={className} style={style} {...leavingProps(isPresent)}>
      {children}
    </div>
  );
}

/** Per card, by card ID. */
type ByCard<T> = Readonly<Record<string, T>>;

export interface CardDockProps {
  cards: CardProps[];
  /** The rows behind each card's source tags: by card ID, then by source ID. */
  sourceRows?: ByCard<SourceRowsBySource>;
  /** By card ID: the source whose rows show when that card first comes to the front. */
  defaultOpenSource?: ByCard<string | null>;
  /** By card ID: the open source, held by the host (see Card's `openSource`). */
  openSource?: ByCard<string | null>;
  /**
   * Called once the last card has finished leaving with the dock around it. A host that changes its layout when
   * the dock empties should keep the dock mounted and change the layout here, or the leave is cut short.
   */
  onExitComplete?: () => void;
}

/** Pure. The extras the front card gets from the dock's per-card maps. */
export function frontExtras(id: string, p: Pick<CardDockProps, "sourceRows" | "defaultOpenSource" | "openSource">): CardExtras {
  const extras: CardExtras = {};
  if (p.sourceRows?.[id] !== undefined) extras.sourceRows = p.sourceRows[id];
  if (p.defaultOpenSource !== undefined && id in p.defaultOpenSource) extras.defaultOpenSource = p.defaultOpenSource[id];
  if (p.openSource !== undefined && id in p.openSource) extras.openSource = p.openSource[id];
  return extras;
}

export function CardDock({ cards, sourceRows, defaultOpenSource, openSource, onExitComplete }: CardDockProps) {
  const reduced = useReducedMotion();
  const shown = cards.filter(cardHasContent).slice(0, STACK_SCALES.length);
  const lift = (shown.length - 1) * STACK_PEEK;
  const leave = dockMotion(0, reduced);
  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {shown.length > 0 ? (
        <motion.aside
          key="dock"
          data-dock=""
          aria-label="Cards"
          className="fixed inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-4 lg:static lg:inset-auto lg:z-auto lg:justify-start lg:px-0 lg:pb-0"
          initial={false}
          exit={leave.exit}
          transition={leave.transition}
        >
          <UntilLeaving className="relative w-full max-w-[343px]" style={{ paddingTop: lift }}>
            <AnimatePresence initial mode="popLayout">
              {shown
                .map((card, depth) => {
                  const front = depth === 0;
                  const m = dockMotion(depth, reduced);
                  return (
                    <motion.div
                      key={card.id}
                      data-depth={depth}
                      data-scale={STACK_SCALES[depth]}
                      aria-hidden={front ? undefined : true}
                      inert={front ? undefined : true}
                      className={front ? "relative origin-top" : "absolute inset-x-0 bottom-0 origin-top"}
                      style={{ zIndex: STACK_SCALES.length - depth, top: front ? undefined : lift }}
                      initial={m.initial}
                      animate={m.animate}
                      exit={m.exit}
                      transition={m.transition}
                    >
                      {front ? (
                        <UntilLeaving>
                          <Card {...card} {...frontExtras(card.id, { sourceRows, defaultOpenSource, openSource })} />
                        </UntilLeaving>
                      ) : (
                        <div data-stack-edge="" className="mat-glass h-full w-full rounded-card" />
                      )}
                    </motion.div>
                  );
                })
                .reverse()}
            </AnimatePresence>
          </UntilLeaving>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
