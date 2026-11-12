"use client";
// An odometer counter (lab-ui-foundation R16.5, brief 015 package E): one ten-face drum per digit in a dark
// inset well. Each drum rolls by itself on spring.settle, forward when the count rises and back when it falls;
// separators stand still, and the bank keeps its width. `null` is a blank drum showing `—`, never `0`.
// Under Reduced_Motion each window shows its digit flat and a new value swaps in without rolling.
// The digit maths lives in ui/instruments/odometer.ts; screen readers get the whole number as one word.
import { motion } from "motion/react";
import { type CSSProperties, useState } from "react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { advanceRoll, drumAngle, formatCount, layoutOdometer, normalizeCount, type OdometerCell, startRoll } from "../../ui/instruments/odometer";
import { DUR, SPRING, STAGGER } from "../../ui/motion";

export { formatCount };

const FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** A drum of ten faces round an axle. Face `d` is turned `d` faces back from the front. */
function Drum({ id, turn, fresh }: { id: string; turn: number; fresh: boolean }) {
  const place = Number(id.slice(1));
  return (
    <motion.span
      data-drum={id}
      className="odo-window"
      initial={fresh ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: DUR.base / 1000 }}
    >
      <span className="odo-axle">
        <motion.span
          className="odo-drum"
          initial={false}
          animate={{ rotateX: drumAngle(turn) }}
          // Higher places start a beat later, like a carry through the gears.
          transition={{ type: "spring", ...SPRING.settle, delay: (place * STAGGER) / 1000 }}
        >
          {FACES.map((d) => (
            <span key={d} className="odo-face" style={{ "--odo-face": d } as CSSProperties}>
              {d}
            </span>
          ))}
        </motion.span>
      </span>
    </motion.span>
  );
}

function Cell({ cell, turn, reduced, fresh }: { cell: OdometerCell; turn: number; reduced: boolean; fresh: boolean }) {
  switch (cell.kind) {
    case "drum":
      return reduced ? (
        <span data-drum={cell.key} className="odo-window">
          <span className="odo-flat">{cell.digit}</span>
        </span>
      ) : (
        <Drum id={cell.key} turn={turn} fresh={fresh} />
      );
    case "dash":
      return (
        <span data-drum={cell.key} data-blank="" className="odo-window">
          <span className="odo-flat text-ink-dim">{COPY.lab.none}</span>
        </span>
      );
    case "still":
      return <span className="odo-still">{cell.char}</span>;
    case "empty":
      return cell.slot === "drum" ? (
        <span data-empty="" className="odo-window">
          <span className="odo-flat" />
        </span>
      ) : (
        <span className="odo-still" />
      );
  }
}

/**
 * `places` is how many digit drums the bank is built for; a shorter number leaves the leading windows empty,
 * so counters that share it line up in one column and never change width.
 */
export function Odometer({ value, places = 1 }: { value: number | null; places?: number }) {
  const reduced = useReducedMotion();
  const n = normalizeCount(value);
  const [roll, setRoll] = useState(() => startRoll(n, places));
  let state = roll;
  if (roll.value !== n || roll.places !== places) {
    // A new value: work out each drum's roll from where it stands (React's adjust-state-on-prop-change pattern).
    state = advanceRoll(roll, n, places);
    setRoll(state);
  }
  return (
    <span data-odometer="" className="odo-well font-mono tabular-nums text-ink">
      <span className="sr-only">{formatCount(n)}</span>
      <span aria-hidden="true" className="odo-bank">
        {layoutOdometer(n, places).map((cell) => (
          <Cell key={cell.key} cell={cell} turn={state.turns[cell.key] ?? 0} reduced={reduced} fresh={state.fresh.includes(cell.key)} />
        ))}
      </span>
    </span>
  );
}
