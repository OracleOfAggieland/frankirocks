"use client";
// The Lab printing a receipt from its slot, and an odometer stepping through values (brief 015 package E).
// Each tile has a button to replay or step, so the motion can be watched as often as needed.
import { useState } from "react";
import { Lab } from "../../../components/surfaces/Lab";
import { Odometer, formatCount } from "../../../components/surfaces/Odometer";
import { Receipt } from "../../../components/surfaces/Receipt";
import { QUIET_BUTTON } from "../../../components/surfaces/classes";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import { LAB, RECEIPT } from "../_fixtures";
import { Section, Tile } from "./Section";

const PRINT_AGAIN = "Print again";
const NEXT_VALUE = "Next value";
const LAB_PRINTING = "The Lab printing a receipt";
const LAB_REDUCED = "The Lab and receipt, reduced motion";
const ODOMETER_AT = (text: string) => `Odometer at ${text}`;
const ODOMETER_REDUCED = "Odometer, reduced motion";

/** Up, across a carry, past a new place, then down again. */
const STEPS: readonly (number | null)[] = [null, 0, 7, 9, 10, 99, 100, 128, 1284, 999, 1000];
const PLACES = 4;

/** Room above the panel for the slip to print into. */
const PRINT_ROOM = "flex min-h-[540px] w-72 max-w-full items-end justify-center";

function PrintingLab({ run }: { run: number }) {
  return (
    <div className={PRINT_ROOM}>
      <Lab {...LAB} receipt={<Receipt key={run} {...RECEIPT} />} />
    </div>
  );
}

export function InstrumentExtrasSection() {
  const [run, setRun] = useState(0);
  const [step, setStep] = useState(0);
  const value = STEPS[step];
  const next = () => setStep((s) => (s + 1) % STEPS.length);
  return (
    <ReducedMotionOverride reduced={false}>
      <Section id="instrument-extras" title="Lab, odometer and receipt">
        <Tile label={LAB_PRINTING} data-specimen="lab-receipt">
          <PrintingLab run={run} />
          <button type="button" className={QUIET_BUTTON} onClick={() => setRun((r) => r + 1)}>
            {PRINT_AGAIN}
          </button>
        </Tile>
        <Tile label={ODOMETER_AT(formatCount(value))} data-specimen="odometer-steps">
          <span className="text-2xl">
            <Odometer value={value} places={PLACES} />
          </span>
          <button type="button" className={QUIET_BUTTON} onClick={next}>
            {NEXT_VALUE}
          </button>
        </Tile>
        <Tile label={ODOMETER_REDUCED} data-specimen="odometer-reduced">
          <div data-reduced="true" className="text-2xl">
            <ReducedMotionOverride reduced>
              <Odometer value={value} places={PLACES} />
            </ReducedMotionOverride>
          </div>
        </Tile>
        <Tile label={LAB_REDUCED} data-specimen="lab-receipt-reduced">
          <div data-reduced="true">
            <ReducedMotionOverride reduced>
              <PrintingLab run={run} />
            </ReducedMotionOverride>
          </div>
        </Tile>
      </Section>
    </ReducedMotionOverride>
  );
}
