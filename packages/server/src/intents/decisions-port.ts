/**
 * The Decisions_Port (voice-control R10.8, R11.2, R11.8; design "The port", question 72). The only server code that
 * calls `/v1/decisions`. It sends a body built by `buildTurnIntents` in core through the OpenAIPort's
 * `decisions.create` endpoint, and enforces the caller's deadline on the opsClock: the Decisions API has no
 * timeout or effort parameter. Tests use Fake_OpenAI; `npm test` makes no Decisions call.
 */
import type { ClockPort, DecisionsBody } from "@franki/core";
import { DeadlineError, type Timers, withDeadline } from "../clock/timers";
import { type Env } from "../config/env";
import { requireModel } from "../config/models";
import type { OpenAIPort } from "../openai/fake";

export type DecideResult = { ok: true; decision: unknown; ms: number } | { ok: false; why: "deadline" | "transport"; ms: number };

export interface DecisionsDeps {
  openai: OpenAIPort;
  timers: Timers;
  clock: ClockPort;
}

export interface DecisionsPort {
  decide(body: DecisionsBody, deadlineMs: number): Promise<DecideResult>;
}

/** The model the TurnIntents body names: FRANKI_BG_MODEL from Model_Config, never a literal. */
export const decisionsModel = (env: Env): string => requireModel("bg", env);

export function decisionsPort(deps: DecisionsDeps): DecisionsPort {
  return {
    async decide(body, deadlineMs) {
      const start = deps.clock.read().opsClock.now;
      const ms = () => deps.clock.read().opsClock.now - start;
      try {
        const decision = await withDeadline(deps.openai.call("decisions.create", body), deadlineMs, deps.timers);
        return { ok: true, decision, ms: ms() };
      } catch (error) {
        return { ok: false, why: error instanceof DeadlineError ? "deadline" : "transport", ms: ms() };
      }
    },
  };
}
