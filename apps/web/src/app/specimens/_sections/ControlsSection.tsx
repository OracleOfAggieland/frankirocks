"use client";
// The two lab controls (brief 015 K) in every state their props allow: the company toggle off, on and
// disabled, and Forget last ready, pending and not available. Two live tiles change on press so the motion
// can be seen. The last tile is forced to reduced motion.
import { useState } from "react";
import { QUIET_BUTTON } from "../../../components/surfaces/classes";
import { CompanyToggle } from "../../../components/surfaces/CompanyToggle";
import { ForgetLast } from "../../../components/surfaces/ForgetLast";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import { Section, Tile } from "./Section";

const noop = () => {};

/** A company toggle that flips on press, so its curtain draw, brass fade and label rise can be watched. */
function LiveCompany() {
  const [company, setCompany] = useState(false);
  return <CompanyToggle company={company} onChange={setCompany} />;
}

type ForgetStep = "ready" | "pending" | "gone";
const NEXT: Record<ForgetStep, ForgetStep> = { ready: "pending", pending: "gone", gone: "ready" };
const STEP_LABEL: Record<ForgetStep, string> = { ready: "Mark pending", pending: "Finish forget", gone: "Bring it back" };

/**
 * Forget last stepped by presses: ready, then pending on the first press, then gone on a press of the
 * small button beside it, which then brings it back. No timers.
 */
function LiveForget() {
  const [step, setStep] = useState<ForgetStep>("ready");
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex min-h-11 items-center">
        <ForgetLast available={step !== "gone"} pending={step === "pending"} onForget={() => setStep("pending")} />
      </div>
      <button type="button" onClick={() => setStep(NEXT[step])} className={QUIET_BUTTON}>
        {STEP_LABEL[step]}
      </button>
    </div>
  );
}

export function ControlsSection() {
  return (
    <ReducedMotionOverride reduced={false}>
      <Section id="controls" title="Lab controls">
        <Tile label="Company toggle, off" data-specimen="control" data-control="company-off">
          <CompanyToggle company={false} onChange={noop} />
        </Tile>
        <Tile label="Company toggle, on" data-specimen="control" data-control="company-on">
          <CompanyToggle company onChange={noop} />
        </Tile>
        <Tile label="Company toggle, disabled" data-specimen="control" data-control="company-disabled">
          <CompanyToggle company={false} disabled onChange={noop} />
        </Tile>
        <Tile label="Forget last, ready" data-specimen="control" data-control="forget-ready">
          <ForgetLast available onForget={noop} />
        </Tile>
        <Tile label="Forget last, pending" data-specimen="control" data-control="forget-pending">
          <ForgetLast available pending onForget={noop} />
        </Tile>
        <Tile label="Forget last, not available: renders nothing" data-specimen="control" data-control="forget-none">
          <div className="mat-blueprint-box flex min-h-11 w-40 items-center justify-center rounded-chip">
            <ForgetLast available={false} onForget={noop} />
          </div>
        </Tile>
        <Tile label="Company toggle, live: press it" data-specimen="control" data-control="company-live">
          <LiveCompany />
        </Tile>
        <Tile label="Forget last, live: ready, then pending, then gone" data-specimen="control" data-control="forget-live">
          <LiveForget />
        </Tile>
        <Tile label="Both, reduced motion" data-specimen="control" data-control="reduced">
          <div data-reduced="true" className="flex flex-col items-center gap-2">
            <ReducedMotionOverride reduced>
              <CompanyToggle company onChange={noop} />
              <ForgetLast available pending onForget={noop} />
            </ReducedMotionOverride>
          </div>
        </Tile>
      </Section>
    </ReducedMotionOverride>
  );
}
