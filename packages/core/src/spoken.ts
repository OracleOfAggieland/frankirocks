/**
 * `spokenGrade(x, c, s)` (contracts §2, §4; KC09; R28.1, R28.2). A Memory may cross to the browser only if it
 * passes `eligible` at stage `project`, is `active` (not history, alleged, scheduled or under review), has
 * `flow:"open"`, has no posture (no effects exist in this slice), is S0 or S1, and has class U, C or O.
 * Pure; anything that cannot be evaluated is denied.
 */
import { type Dependent, type EC, type ER, type Snapshot, eligible } from "./eligible";
import type { Memory } from "./schema/records";
import { isPlainObject } from "./schema/v";

export function spokenGrade(x: Dependent, c: EC, s: Snapshot): ER {
  if (!isPlainObject(c) || !isPlainObject(x) || !isPlainObject(x.ref)) return { allow: false, reason: "ineligible" };
  const e = eligible(x, { ...c, stage: "project" }, s);
  if (!e.allow) return e;
  if (x.ref.collection !== "memories") return { allow: false, reason: "ineligible" };
  const m = x.row as Memory;
  if (m.status !== "active") return { allow: false, reason: "stale" };
  if (m.flow !== "open") return { allow: false, reason: "flow" };
  if (m.sens !== "S0" && m.sens !== "S1") return { allow: false, reason: "sensitivity" };
  if (!["U", "C", "O"].includes(m.sourceClass)) return { allow: false, reason: "authority" };
  return { allow: true, reason: "ok" };
}
