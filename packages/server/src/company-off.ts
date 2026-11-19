/**
 * Owner ruling, Nov 19: a smooth working demo comes before two fail-closed gates, while company mode is off
 * (`FRANKI_COMPANY_MODE` is not "on"; brief 053). With company mode on, both rules below are exactly as before.
 *
 *   1. A slow parse that failed (a refusal or another invalid answer, a missed deadline, a transport error, an
 *      oversize line, a failed Parse_Repair) counts as an ordinary committed parse with no intent hit, for the
 *      parse watermark and the audience: it leaves no Parse_Gap and no `unknown` audience. The Server_Rule still
 *      reads the parse as failed for the turn's own reply, so a regex hit still decides a cut there.
 *   2. The owner's own final voice line (class U) counts as a certain speaker without the judge's `O`, wherever that
 *      decides what may be said. Food and allergy paths keep their own rule (`routes/tool-food.ts`).
 */
import type { Turn } from "@franki/core";
import { type Env, companyModeOn } from "./config/env";

/** Rule 1: a failed slow parse counts as an ordinary committed one (company mode off). */
export const failedParseIsOrdinary = (env: Env): boolean => !companyModeOn(env);

/**
 * Rule 2: whether a Turn's speaker is certain for what may be said: a typed line (no audio items), a line the judge
 * called `O`, or, with company mode off, a final class-U voice line. Callers keep their own class checks.
 */
export function ownerSpeakerCertain(t: Pick<Turn, "itemIds" | "judge" | "sourceClass" | "final">, env: Env): boolean {
  if (t.itemIds.length === 0 || t.judge === "O") return true;
  return !companyModeOn(env) && t.sourceClass === "U" && t.final;
}
