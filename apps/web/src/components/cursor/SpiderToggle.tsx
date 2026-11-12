"use client";
// The "Lab spider" switch in the footer. It shows nothing on devices where the spider can't run (touch,
// no hover, reduced motion) and nothing on the server. The choice is remembered.
import { COPY } from "../../ui/copy";
import { FOCUS, TARGET } from "../surfaces/classes";
import { setSpiderOn, useSpiderCanRun, useSpiderOn } from "./use-spider";

/** The switch itself: a small brass track when on, an ink-dim outline when off. */
export function SpiderSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      data-spider-toggle={on ? "on" : "off"}
      className={`${TARGET} ${FOCUS} ml-3 inline-flex items-center gap-2 rounded-control px-2 align-middle text-xs text-ink-dim transition-colors duration-(--dur-quick) hover:text-ink`}
    >
      <span>{COPY.cursor.toggle}</span>
      <span aria-hidden="true" className={`spider-toggle-track ${on ? "mat-brass" : ""}`}>
        <span className="spider-toggle-knob" />
      </span>
    </button>
  );
}

export function SpiderToggle() {
  const canRun = useSpiderCanRun();
  const on = useSpiderOn();
  if (!canRun) return null;
  return <SpiderSwitch on={on} onToggle={() => setSpiderOn(!on)} />;
}
