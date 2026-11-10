/**
 * The slow parse per line for the judge spike (voice-control R17.2, R17.4; design "`judge_v2` and the Harness").
 * After each line's transcript the Harness runs the server's `runSlowParse` through a Decisions_Port:
 *   - the fake port (the default): every probability 0, at 0 ms, marked `fake` in the summary;
 *   - the live port, only with `--live`: the server's own `decisionsPort` over the live OpenAI adapter.
 * The Harness waits up to HARNESS_PARSE_WAIT_MS, so a parse slower than the app's 350 ms deadline still reports its
 * real time; `missedDeadline` marks it.
 */
import { DECISIONS_DEADLINE_MS, type DecisionsBody } from "@franki/core";
import { liveClockPort } from "../../packages/server/src/clock/live-clock";
import { liveTimers } from "../../packages/server/src/clock/timers";
import type { Env } from "../../packages/server/src/config/env";
import { type DecisionsPort, decisionsPort } from "../../packages/server/src/intents/decisions-port";
import { type SlowParse, runSlowParse } from "../../packages/server/src/intents/slow-parse";
import { liveOpenAI } from "../../packages/server/src/openai/live";

/** How long the Harness waits for one parse; only the app's deadline counts as on time. */
export const HARNESS_PARSE_WAIT_MS = 5_000;

export type DecisionsKind = "fake" | "live";

/** The fake port: every question answered with probability 0, at once. No network. */
export function fakeDecisionsPort(): DecisionsPort {
  return {
    async decide(body: DecisionsBody) {
      return { ok: true, decision: { answers: body.questions.map((q) => ({ type: "predicate", name: q.name, probability: 0 })) }, ms: 0 };
    },
  };
}

/** The live port: `/v1/decisions` through the server's adapter. Built only for a `--live` run. */
export function liveDecisionsPort(env: Env): DecisionsPort {
  return decisionsPort({ openai: liveOpenAI(env), timers: liveTimers, clock: liveClockPort });
}

/** One line's slow parse, as the row records it (R17.4). */
export interface ParseRow {
  regex: { hit: boolean; ids: string[] };
  parse: {
    probabilities: Record<string, number> | null;
    /** The chosen control class of a hit; null for an ordinary or failed parse. */
    chosen: string | null;
    ordinary: boolean;
    ms: number;
    /** Slower than the app's 350 ms deadline, or failed on it. */
    missedDeadline: boolean;
    failure: string | null;
  };
}

export function parseRowOf(p: SlowParse): ParseRow {
  const failure = p.parse.kind === "failed" ? p.parse.why : null;
  return {
    regex: { hit: p.regex.length > 0, ids: [...p.regex] },
    parse: {
      probabilities: p.probabilities === null ? null : { ...p.probabilities },
      chosen: p.parse.kind === "hit" ? p.parse.chosen : null,
      ordinary: p.parse.kind === "ordinary",
      ms: p.ms,
      missedDeadline: failure === "deadline" || p.ms > DECISIONS_DEADLINE_MS,
      failure,
    },
  };
}

/**
 * The per-line slow parse the Harness calls. The TurnIntents body names FRANKI_BG_MODEL; a dry run without it
 * names "unset", which the fake port never sends anywhere.
 */
export function lineParser(port: DecisionsPort, env: Env, live: boolean): (turnId: string, utterance: string) => Promise<ParseRow> {
  const parseEnv: Env = live ? env : { ...env, FRANKI_BG_MODEL: env.FRANKI_BG_MODEL ?? "unset" };
  return async (turnId, utterance) => parseRowOf(await runSlowParse({ decisions: port, env: parseEnv, log: () => {} }, { turnId, utterance }, HARNESS_PARSE_WAIT_MS));
}
