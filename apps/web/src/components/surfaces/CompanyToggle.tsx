"use client";
// The company toggle (brief 015 K; UI direction "Surfaces"): a brass switch. Off, it is a brass-edged
// capsule with a door glyph that reads "Someone walked in". On, it is filled brass with a drawn curtain
// glyph and reads "We're alone", the words that turn it back off.
//
// The capsule is glass with a brass edge; the brass fill is its own layer over the glass that fades in and
// out, so only opacity changes. Its accessible name is "Company mode: " plus the visible label, so a screen
// reader hears "Company mode ... on" while someone is in the room. The capsule keeps the
// width of its longer label in both states, so it never jumps. The press depresses 2 px on spring.press;
// under reduced motion there is no press and the glyphs only fade.
import { motion } from "motion/react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { SPRING } from "../../ui/motion";
import { FOCUS, TARGET } from "./classes";

export interface CompanyToggleProps {
  company: boolean;
  disabled?: boolean;
  onChange(next: boolean): void;
}

/** The switch's stable name; the visible label follows it, so the name always says what is on or off. */
const NAME = "Company mode";

const CAPSULE = `${TARGET} ${FOCUS} group mat-glass relative isolate inline-flex items-center justify-center rounded-chip border-brass! px-4 text-sm font-medium transition-colors duration-(--dur-base) disabled:cursor-not-allowed disabled:opacity-40`;
const OFF = "text-ink enabled:hover:bg-night-2/90";
const ON = "text-night-0";

/** A door standing ajar on its left hinge: frame, floor, the swung panel and its knob. */
export function DoorGlyph() {
  return (
    <svg data-glyph="door" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" className="pointer-events-none shrink-0 text-brass-hi">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21" />
        <path d="M3 21h18" />
        <path d="M6 3.4l6.5 1.6v14.6L6 21" />
      </g>
      <circle cx="10.6" cy="12.4" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** Curtains drawn shut on a rod: two panels meeting in the middle, each with a fold and a scalloped hem. */
export function CurtainGlyph() {
  return (
    <svg data-glyph="curtain" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" className="pointer-events-none shrink-0">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.6 3.5h18.8" />
        <g className="franki-curtain-l">
          <path d="M3.6 3.5V19.6q2.05 1 4.1 0t4.1 0V3.5" />
          <path d="M7.7 6v11.6" />
        </g>
        <g className="franki-curtain-r">
          <path d="M12.2 3.5V19.6q2.05 1 4.1 0t4.1 0V3.5" />
          <path d="M16.3 6v11.6" />
        </g>
      </g>
      <circle cx="2.2" cy="3.5" r="1" fill="currentColor" />
      <circle cx="21.8" cy="3.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function CompanyToggle({ company, disabled = false, onChange }: CompanyToggleProps) {
  const reduced = useReducedMotion();
  const label = company ? COPY.company.alone : COPY.company.walkedIn;
  const other = company ? COPY.company.walkedIn : COPY.company.alone;
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={company}
      aria-label={`${NAME}: ${label}`}
      disabled={disabled}
      data-company={company ? "on" : "off"}
      onClick={() => onChange(!company)}
      whileTap={disabled || reduced ? undefined : { y: 2 }}
      transition={{ type: "spring", ...SPRING.press }}
      className={`${CAPSULE} ${company ? ON : OFF}`}
    >
      <span
        aria-hidden="true"
        data-brass-fill={company ? "on" : "off"}
        className={`mat-brass pointer-events-none absolute inset-0 -z-10 rounded-chip transition-opacity duration-(--dur-base) ${company ? "opacity-100" : "opacity-0"}`}
      />
      <span className="grid whitespace-nowrap">
        <span key={company ? "on" : "off"} className="franki-control-in col-start-1 row-start-1 flex items-center justify-center gap-2">
          {company ? <CurtainGlyph /> : <DoorGlyph />}
          {label}
        </span>
        <span aria-hidden="true" data-width-keeper="" className="invisible col-start-1 row-start-1 flex items-center gap-2">
          <span className="size-[18px] shrink-0" />
          {other}
        </span>
      </span>
    </motion.button>
  );
}
