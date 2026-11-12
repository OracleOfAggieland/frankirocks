/**
 * The Harness's FastSlotsV1 measurement (brief 012 item 6, task A9). With `--fast-slots`, every line whose
 * transcript matches RX4, RX6 or RX7, or whose slow parse has `hardRule`, `correct` or `transition` at 0.20 or more,
 * is sent to FastSlotsV1 through a port: the fake (the default, valid and empty at 0 ms, marked `fake`) or, only
 * with `--live`, the server's own `fastSlotsPort`. The Harness waits up to HARNESS_SLOTS_WAIT_MS, so a slow answer
 * still reports its real time; `overDeadline` marks anything past FAST_SLOTS_DEADLINE_MS.
 *
 * A row holds the time, the result kind, why it was invalid, and the item kinds. Never the transcript or any item
 * text: no words from the owner's takes are stored. In a dry run the fake transport's transcript means nothing, so
 * the line's own text from lines.json stands in for it.
 */
import {
  CANDIDATE_P,
  FAST_SLOTS_DEADLINE_MS,
  type FastItem,
  type FastSlotsInput,
  type FastSlotsResult,
  REGEX_TABLE,
  UNCERTAIN_SPEAKER_P,
  lookupAllergen,
  normalizeForRegex,
  scanAliases,
} from "@franki/core";
import { liveClockPort } from "../../packages/server/src/clock/live-clock";
import { liveTimers } from "../../packages/server/src/clock/timers";
import type { Env } from "../../packages/server/src/config/env";
import { type FastSlotsPort, fastSlotsPort } from "../../packages/server/src/onturn/fast-slots-port";
import { liveOpenAI } from "../../packages/server/src/openai/live";
import type { ParseRow } from "./decisions";
import { type SlotsRoute, fixtureInput } from "./fast-slots-fixture";
import type { LineClass, ProbeLine } from "./lines";

export type { SlotsRoute } from "./fast-slots-fixture";

/** How long the Harness waits for one FastSlotsV1 answer; only FAST_SLOTS_DEADLINE_MS counts as on time. */
export const HARNESS_SLOTS_WAIT_MS = 5_000;

export type SlotsKind = "fake" | "live";

export interface FastSlotsRow {
  lineId: string;
  class: LineClass;
  /** The routes the line opened, and what opened them (design 3.0). */
  routes: SlotsRoute[];
  triggers: ("regex" | "candidate")[];
  ms: number;
  result: FastSlotsResult["kind"];
  /** Why an answer was invalid, and at which path; null otherwise. */
  reason: string | null;
  path: string | null;
  /** The kinds of the items returned, in order (never their words). */
  kinds: string[];
  /**
   * The kinds of the items that pass the code's own first checks against the input sent: the span quotes the turn
   * exactly, an allergy names a gazetteer allergen, and a correction names only targets that were sent. Not
   * validateItems' full tables. Empty when no input was given.
   */
  checked: string[];
  need: string | null;
  overDeadline: boolean;
}

const ROUTE_OF_REGEX: Record<string, SlotsRoute> = { RX4: "hardRule", RX6: "correct", RX7: "transition" };
const ROUTES: readonly SlotsRoute[] = ["hardRule", "correct", "transition"];

/** The routes a line opens: a route regex on the text, or a route candidate at CANDIDATE_P or more. */
export function slotsRoutes(text: string, parse: ParseRow["parse"] | null): { routes: SlotsRoute[]; triggers: ("regex" | "candidate")[] } {
  const said = normalizeForRegex(text);
  const byRegex = REGEX_TABLE.filter((r) => ROUTE_OF_REGEX[r.id] !== undefined && r.pattern.test(said)).map((r) => ROUTE_OF_REGEX[r.id]!);
  const p = parse?.probabilities ?? null;
  const byParse = p === null ? [] : ROUTES.filter((r) => (p[r] ?? 0) >= CANDIDATE_P);
  const routes = ROUTES.filter((r) => byRegex.includes(r) || byParse.includes(r));
  const triggers: ("regex" | "candidate")[] = [...(byRegex.length > 0 ? ["regex" as const] : []), ...(byParse.length > 0 ? ["candidate" as const] : [])];
  return { routes, triggers };
}

/** The fake port: a valid, empty answer at once. No network. */
export function fakeFastSlotsPort(): FastSlotsPort {
  return { slots: async () => ({ kind: "valid", out: { items: [], need: "none" }, ms: 0 }) };
}

/** The live port: the server's own FastSlotsV1 port over the live OpenAI adapter. Built only for a `--live` run. */
export function liveFastSlotsPort(env: Env): FastSlotsPort {
  return fastSlotsPort({ openai: liveOpenAI(env), timers: liveTimers, clock: liveClockPort, env });
}

/** Whether one item passes the code's first checks against the input it answered (see FastSlotsRow.checked). */
export function passesFirstChecks(item: FastItem, input: FastSlotsInput): boolean {
  const s = item.span;
  if (s.eid !== input.turn.eid || s.end > input.turn.text.length || input.turn.text.slice(s.start, s.end) !== s.quote) return false;
  if (item.kind === "allergy") return lookupAllergen(item.item).some((c) => c !== "none") || scanAliases(input.turn.text, s.start, s.end).length > 0;
  if (item.kind === "correction") {
    const sent = new Set(input.targets.map((t) => t.id));
    return item.targetIds.length > 0 && item.targetIds.every((id) => sent.has(id));
  }
  return true;
}

/** The row for one answer; `input` is what was sent, for the first checks. */
export function rowOf(line: Pick<ProbeLine, "id" | "class">, opened: ReturnType<typeof slotsRoutes>, r: FastSlotsResult, input: FastSlotsInput | null = null): FastSlotsRow {
  return {
    lineId: line.id,
    class: line.class,
    routes: opened.routes,
    triggers: opened.triggers,
    ms: r.ms,
    result: r.kind,
    reason: r.kind === "invalid" ? r.reason : null,
    path: r.kind === "invalid" ? r.path : null,
    kinds: r.kind === "valid" ? r.out.items.map((i) => i.kind) : [],
    checked: r.kind === "valid" && input !== null ? r.out.items.filter((i) => passesFirstChecks(i, input)).map((i) => i.kind) : [],
    need: r.kind === "valid" ? r.out.need : null,
    overDeadline: r.kind === "timeout" || r.ms > FAST_SLOTS_DEADLINE_MS,
  };
}

/** Runs FastSlotsV1 for one line when it opens a route; null when it opens none. */
export function slotsLiner(port: FastSlotsPort): (line: ProbeLine, utterance: string, parse: ParseRow["parse"] | null) => Promise<FastSlotsRow | null> {
  return async (line, utterance, parse) => {
    const opened = slotsRoutes(utterance, parse);
    if (opened.routes.length === 0) return null;
    const input = fixtureInput(line.id, utterance, opened.routes);
    return rowOf(line, opened, await port.slots(input, HARNESS_SLOTS_WAIT_MS), input);
  };
}

/** One log line, with no words from the line. */
export function slotsLogLine(r: FastSlotsRow): string {
  const why = r.result === "invalid" ? ` (${r.reason}${r.path === null ? "" : ` at ${r.path}`})` : "";
  return `  fast-slots ${r.lineId}: ${r.result}${why} in ${r.ms} ms${r.overDeadline ? " (over the deadline)" : ""}, items [${r.kinds.join(", ")}], routes ${r.routes.join("+")}`;
}

// ---------------------------------------------------------------------------------------------
// Speaker certainty in an earlier run (design G19, CQ 112)

export type SpeakerCount = { file: string; hardRule: { pass: number; of: number }; correction: { pass: number; of: number } } | { file: string | null; unavailable: string };

interface EarlierRow {
  class?: string;
  parse?: { probabilities?: Record<string, number> | null; failure?: string | null } | null;
}

/**
 * How many hardRule and correction lines of an earlier run would pass `speakerCertain`: a committed parse, with
 * `uncertainSpeaker` under 0.10 and no company or quiet candidate. Says it can't when the run holds no probabilities.
 */
export function speakerCertainCount(file: string, rows: readonly EarlierRow[]): SpeakerCount {
  const of = (cls: string) => rows.filter((r) => r.class === cls);
  const wanted = [...of("hardRule"), ...of("correction")];
  if (wanted.length === 0) return { file, unavailable: "the run has no hardRule or correction lines" };
  if (wanted.some((r) => r.parse === undefined || r.parse === null || r.parse.probabilities === undefined)) return { file, unavailable: "the run file holds no parse probabilities for every line" };
  const certain = (r: EarlierRow) => {
    const p = r.parse?.probabilities ?? null;
    return p !== null && (r.parse?.failure ?? null) === null && (p.uncertainSpeaker ?? 1) < UNCERTAIN_SPEAKER_P && (p.company ?? 0) < CANDIDATE_P && (p.quiet ?? 0) < CANDIDATE_P;
  };
  const count = (cls: string) => ({ pass: of(cls).filter(certain).length, of: of(cls).length });
  return { file, hardRule: count("hardRule"), correction: count("correction") };
}
