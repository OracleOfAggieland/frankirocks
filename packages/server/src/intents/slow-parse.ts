/**
 * The slow parse (TurnIntents, contracts §5; voice-control R10, R11; design "The slow parse"): the Regex_Table,
 * then one Decisions call with the caller's deadline (1,000 ms on a call). Failure is never a guess: a refusal, a bad answer, a missed
 * deadline or a transport error is `failed`, and the Server_Rule decides from that (R11.2). A regex match is
 * recorded and returned; it decides only when the parse failed (R10.2; question 90).
 */
import { DECISIONS_DEADLINE_MS, type InvalidReason, type Probabilities, type RuleParse, buildTurnIntents, outcomeOf, parseDecision, regexMatch } from "@franki/core";
import type { Env } from "../config/env";
import type { Log } from "../routes/runtime";
import { type DecisionsPort, decisionsModel } from "./decisions-port";

/** With no call open the typed reply takes longer than this anyway, so the parse may too (review of wave A, item 17). */
export const DECISIONS_NO_CALL_DEADLINE_MS = 2_000;

export interface SlowParse {
  parse: Extract<RuleParse, { kind: "ordinary" | "hit" | "failed" }>;
  /** Regex_Table IDs that matched. */
  regex: string[];
  /** The 14 probabilities, when the Decisions answer parsed. */
  probabilities: Probabilities | null;
  ms: number;
  /** Which check an `invalid` answer failed, by question name; never the words (review of the live run, item 4). */
  invalid: { reason: InvalidReason; index: number | null; name: string | null } | null;
}

export interface SlowParseDeps {
  decisions: DecisionsPort;
  env: Env;
  log: Log;
}

export async function runSlowParse(deps: SlowParseDeps, input: { turnId: string; utterance: string; lastQuestion?: string | null }, deadlineMs = DECISIONS_DEADLINE_MS): Promise<SlowParse> {
  const regex = regexMatch(input.utterance);
  // IDs only, never the words (question 90).
  if (regex.length > 0) deps.log("turn.regex", { turnId: input.turnId, ids: regex });
  const built = buildTurnIntents({ utterance: input.utterance, lastQuestion: input.lastQuestion ?? null, doors: [] }, decisionsModel(deps.env));
  if (!built.ok) return { parse: { kind: "failed", why: built.why === "oversize" ? "oversize" : "invalid" }, regex, probabilities: null, ms: 0, invalid: null };
  const r = await deps.decisions.decide(built.body, deadlineMs);
  if (!r.ok) return { parse: { kind: "failed", why: r.why }, regex, probabilities: null, ms: r.ms, invalid: null };
  const parsed = parseDecision(r.decision, built.body.questions);
  if (!parsed.ok) {
    const invalid = { reason: parsed.reason, index: parsed.index, name: parsed.name };
    deps.log("turn.parseInvalid", { turnId: input.turnId, reason: parsed.reason, index: parsed.index ?? -1, question: parsed.name ?? "" });
    return { parse: { kind: "failed", why: "invalid" }, regex, probabilities: null, ms: r.ms, invalid };
  }
  return { parse: outcomeOf(parsed.intents.p), regex, probabilities: parsed.intents.p, ms: r.ms, invalid: null };
}
