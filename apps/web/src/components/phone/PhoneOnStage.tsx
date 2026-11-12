"use client";
// The phone on Franki's wall: a wooden wall telephone with two brass bells, a finger wheel, a crank and a handset on
// a cradle, built in three.js (phone/three/). It hangs beside Franki only while a phone call is out, and acts the call:
//   dialing   the handset goes to Franki's ear and the wheel winds and returns, digit by digit
//   ringing   the bells shake in bursts, the clapper swings, strokes flash off the bells
//   talking   the lamp in the dial glows and waves pulse at the earpiece
//   ended     the handset goes back on the cradle and the bell gives one last tap
//   missed    the handset goes back on the cradle and the lamp glows ember
// Under Reduced_Motion the same phone is drawn still, in the pose each phase comes to rest in. The words under the
// phone say the same thing it shows, so nothing depends on the motion, and they are all that shows if WebGL fails.
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, EASE } from "../../ui/motion";
import type { MissReason, PhonePhase, PhoneView } from "../../ui/phone/phone-call";
import { ThreePhone } from "./ThreePhone";

type ShownPhase = Exclude<PhonePhase, "absent">;

export function phoneCaption(phase: ShownPhase, reason: MissReason | null): string {
  if (phase === "missed") return COPY.phone.missed[reason ?? "failed"];
  return COPY.phone[phase];
}

/**
 * Where the phone's canvas lies on the stage. It is far wider than the phone: the phone hangs in its right half,
 * beside Franki's shoulder, and the left half reaches over Franki so the handset can travel to its ear. Smaller and
 * closer in on a narrow screen, where it still ends inside the viewport.
 */
export const PHONE_PLACE = "pointer-events-none absolute left-[35%] top-[2%] aspect-[6/5] w-[115%] max-sm:left-[30%] max-sm:top-[10%] max-sm:w-[92%]";

/** The words sit under the phone itself, which is right of the canvas's middle. */
export const PHONE_CAPTION = "absolute left-[72%] top-[97%] -translate-x-1/2 whitespace-nowrap font-mono text-xs text-ink-dim";

/**
 * The phone in its place, with its words. It appears when a call starts and fades when the call is over; the phone
 * that leaves is the last one shown. Rendered inside the Stage, which is the positioning box.
 */
export function PhoneOnStage({ view }: { view: PhoneView }) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  return (
    <AnimatePresence>
      {view.phase === "absent" ? null : (
        <motion.div
          key="phone"
          data-phone=""
          role="img"
          aria-label={COPY.phone.label[view.phase]}
          className={PHONE_PLACE}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.base / 1000, ease: EASE.ecto }}
        >
          {/* Remounted when Reduced_Motion changes: a still phone and a moving one are built differently. */}
          {failed ? null : <ThreePhone key={reduced ? "still" : "moving"} view={{ phase: view.phase, reason: view.reason }} still={reduced} onFail={onFail} />}
          <span data-phone-caption="" className={PHONE_CAPTION}>
            {phoneCaption(view.phase, view.reason)}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
