/**
 * Brief 049 part A, ruling 8: the check between the planner's last output and anything said or shown. Pure.
 *
 * Always: a line is kept only when at least one of its refs names Evidence this Errand actually read and that is
 * still readable (`ErrandRefView`); refs that name nothing are dropped from the line; a line's class is the
 * lowest-trust class among its kept refs and its sensitivity the highest; a line that rests on third-party text gets
 * code's attribution, never the model's. Never: keeps a line with no kept ref, or reads a clock, a store or a model.
 */
import type { Class, Sens } from "../schema/primitives";
import type { ErrandLine, ErrandSource } from "../schema/records";
import { civilDay } from "../time";
import { safeName } from "../safe-name";
import { ERRAND_LINES_MAX, ERRAND_LINE_CHARS, ERRAND_LINE_REFS_MAX, ERRAND_OUTCOMES, type ErrandOutcome } from "./limits";

/** One ref as the check sees it: the Evidence behind it, reread now. Null `cls` means it is gone or unreadable. */
export interface ErrandRefView {
  ref: string;
  cls: Class | null;
  sens: Sens;
  source: ErrandSource;
}

/** The planner's last output, as it parsed: an outcome and at most three lines with the refs they rest on. */
export interface PlannerOutput {
  outcome: ErrandOutcome;
  lines: { text: string; refs: string[] }[];
}

/** Trust, highest first: the owner's own words, then confirmed, own records, third party, inferred. */
const TRUST: readonly Class[] = ["U", "C", "O", "T", "M"];
const SENS: readonly Sens[] = ["S0", "S1", "S2"];

/** The planner's raw text as a `PlannerOutput`, or null when it is not one (an unknown key fails it). */
export function parsePlannerOutput(text: string | null): PlannerOutput | null {
  if (text === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== "outcome" && k !== "lines")) return null;
  if (typeof o.outcome !== "string" || !(ERRAND_OUTCOMES as readonly string[]).includes(o.outcome)) return null;
  if (!Array.isArray(o.lines)) return null;
  const lines: PlannerOutput["lines"] = [];
  for (const l of o.lines.slice(0, ERRAND_LINES_MAX)) {
    if (typeof l !== "object" || l === null || Array.isArray(l)) return null;
    const x = l as Record<string, unknown>;
    if (Object.keys(x).some((k) => k !== "text" && k !== "refs")) return null;
    if (typeof x.text !== "string" || !Array.isArray(x.refs) || !x.refs.every((r) => typeof r === "string")) return null;
    lines.push({ text: x.text, refs: x.refs as string[] });
  }
  return { outcome: o.outcome as ErrandOutcome, lines };
}

/** "From Dana Park, Tuesday:", from the source's own fields through `safeName`, in the owner's zone. */
export function errandAttribution(source: ErrandSource, nowMs: number, zone: string): string {
  if (source.kind !== "mail") return "From someone else's invitation:";
  const at = Date.parse(source.at);
  if (!Number.isFinite(at)) return `From ${safeName(source.from)}:`;
  const day = civilDay(at, zone);
  const today = civilDay(nowMs, zone);
  const yesterday = civilDay(nowMs - 86_400_000, zone);
  const when = day.date === today.date ? "today" : day.date === yesterday.date ? "yesterday" : nowMs - at < 6 * 86_400_000 && at <= nowMs ? day.weekday : day.date;
  return `From ${safeName(source.from)}, ${when}:`;
}

/** A line as the check leaves it: the run's taint (`taintErrandLines`) then decides whether it may be spoken. */
export type CheckedLine = Omit<ErrandLine, "speak">;

/**
 * The lines that may be said or shown, checked against the refs this Errand read. An `answered` outcome with no line
 * left is `nothing`; a `nothing` or `failed` outcome keeps no line. The run's taint, the text cleaning and the final
 * attribution come after, in `taintErrandLines` (review fixes V1, V3).
 */
export function checkErrandResult(out: PlannerOutput, refs: readonly ErrandRefView[], at: { nowMs: number; zone: string }): { outcome: ErrandOutcome; lines: CheckedLine[] } {
  if (out.outcome === "failed") return { outcome: "failed", lines: [] };
  // Only an answer keeps lines: "nothing" with lines is a contradiction, and it fails closed to no line.
  if (out.outcome === "nothing") return { outcome: "nothing", lines: [] };
  const byRef = new Map(refs.filter((r) => r.cls !== null).map((r) => [r.ref, r]));
  const lines: CheckedLine[] = [];
  for (const l of out.lines.slice(0, ERRAND_LINES_MAX)) {
    const text = l.text.trim().slice(0, ERRAND_LINE_CHARS).trim();
    const kept = [...new Set(l.refs)].filter((r) => byRef.has(r)).slice(0, ERRAND_LINE_REFS_MAX);
    if (text.length === 0 || kept.length === 0) continue;
    const views = kept.map((r) => byRef.get(r)!);
    const cls = views.reduce<Class>((a, v) => (TRUST.indexOf(v.cls!) > TRUST.indexOf(a) ? v.cls! : a), "U");
    const sens = views.reduce<Sens>((a, v) => (SENS.indexOf(v.sens) > SENS.indexOf(a) ? v.sens : a), "S0");
    const third = views.find((v) => (v.cls === "T" || v.cls === "M") && v.source.kind === "mail") ?? views.find((v) => v.cls === "T" || v.cls === "M");
    const attribution = third === undefined ? null : errandAttribution(third.source, at.nowMs, at.zone);
    lines.push({ text, refs: kept, cls, sens, attribution });
  }
  if (lines.length === 0) return { outcome: "nothing", lines: [] };
  return { outcome: out.outcome, lines };
}
