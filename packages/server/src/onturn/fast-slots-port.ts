/**
 * The FastSlots port (brief 012 design 2.2, 2.3; task A4). The only server code that calls FastSlotsV1. It builds
 * the body in core with the model from Model_Config (`FRANKI_BG_MODEL`, never a literal), sends it through the
 * OpenAIPort's `responses.create`, enforces the caller's deadline on the opsClock and parses the answer in core.
 * A missed deadline is `timeout`, a thrown error `transport`; a turn too long to send is `invalid("oversize")`.
 * Tests use Fake_OpenAI or `FakeFastSlots`; `npm test` makes no FastSlots call.
 */
import { type ClockPort, type FastSlotsInput, type FastSlotsResult, buildFastSlots, parseFastSlots } from "@franki/core";
import { DeadlineError, type Timers, withDeadline } from "../clock/timers";
import type { Env } from "../config/env";
import { requireModel } from "../config/models";
import type { OpenAIPort } from "../openai/fake";
import type { ResponsesResult } from "../openai/responses";

export interface FastSlotsPort {
  slots(input: FastSlotsInput, deadlineMs: number): Promise<FastSlotsResult>;
}

export interface FastSlotsDeps {
  openai: OpenAIPort;
  timers: Timers;
  clock: ClockPort;
  env: Env;
}

/** The model FastSlotsV1 names: FRANKI_BG_MODEL from Model_Config. */
export const fastSlotsModel = (env: Env): string => requireModel("bg", env);

const isResponses = (r: unknown): r is ResponsesResult =>
  typeof r === "object" && r !== null && "status" in r && "outputText" in r && "refusal" in r;

export function fastSlotsPort(deps: FastSlotsDeps): FastSlotsPort {
  return {
    async slots(input, deadlineMs) {
      const start = deps.clock.read().opsClock.now;
      const ms = () => deps.clock.read().opsClock.now - start;
      // A missing model setting must not throw out of the turn: it answers `transport`, so the reply still plays
      // and nothing is written (fail closed), the same as a failed call.
      let built: ReturnType<typeof buildFastSlots>;
      try {
        built = buildFastSlots(fastSlotsModel(deps.env), input);
      } catch {
        return { kind: "transport", ms: ms() };
      }
      if (!built.ok) return { kind: "invalid", reason: built.why === "oversize" ? "oversize" : "empty", path: null, ms: 0 };
      let result: unknown;
      try {
        result = await withDeadline(deps.openai.call("responses.create", built.body), deadlineMs, deps.timers);
      } catch (error) {
        return error instanceof DeadlineError ? { kind: "timeout", ms: ms() } : { kind: "transport", ms: ms() };
      }
      if (!isResponses(result)) return { kind: "invalid", reason: "empty", path: null, ms: ms() };
      return parseFastSlots(result, ms());
    },
  };
}
