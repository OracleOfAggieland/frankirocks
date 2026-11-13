/**
 * The ForgetResolveV1 port over the OpenAIPort (brief 048 ruling 6: the route drives the job, so it needs a resolver).
 * The model only reads the request and the candidates and names the scope; `checkResolve` in `@franki/core` decides
 * what its answer may do, so anything this returns is checked by code before a row moves. The model is
 * `FRANKI_BG_MODEL` from Model_Config. A missed deadline, a transport error, a refusal or text that is not JSON throws,
 * and the executor retries the step (fails closed: nothing is resolved). Tests script `responses.create`; `npm test`
 * makes no paid call.
 *
 * This is the only model call that reads the forget request after admission chose forget (brief 048 ruling 4): it is
 * the forget's own reader, and its input carries the request span and the candidates' typed labels only.
 */
import type { ClockPort, ForgetResolveInputV1 } from "@franki/core";
import { type Timers, withDeadline } from "../clock/timers";
import type { Env } from "../config/env";
import { requireModel } from "../config/models";
import type { OpenAIPort } from "../openai/fake";
import type { ResponsesResult } from "../openai/responses";
import type { ForgetResolvePort } from "./resolve-port";

/** One resolve page's deadline (contracts §8 step 4: 1.5 s a page). */
export const FORGET_RESOLVE_DEADLINE_MS = 1_500;

/** The fixed instructions. The answer's shape is ForgetResolveOutputV1 (contracts §5). */
export const FORGET_RESOLVE_INSTRUCTIONS =
  "You read one forget request and the owner's committed turns and stored memories. Name only what the request asks to forget. " +
  'Answer one JSON object: {"resolution":"exact"|"ambiguous"|"none","remove":[spans copied exactly from the turns],"candidateIds":[memory IDs from the candidates],' +
  '"entityIds":[],"topicKeys":[],"needsMore":boolean,"clarification":null or {"reason":"which_person"|"which_topic"|"which_time"|"protected_rule","optionIds":[IDs]}}. ' +
  "Never name a protected rule. If more than one thing could be meant, answer ambiguous.";

export interface ResolveLiveDeps {
  openai: OpenAIPort;
  timers: Timers;
  clock: ClockPort;
  env: Env;
}

const isResponses = (r: unknown): r is ResponsesResult => typeof r === "object" && r !== null && "status" in r && "outputText" in r && "refusal" in r;

export function liveForgetResolve(deps: ResolveLiveDeps): ForgetResolvePort {
  return {
    async resolve(input: ForgetResolveInputV1) {
      const body = {
        model: requireModel("bg", deps.env),
        instructions: FORGET_RESOLVE_INSTRUCTIONS,
        input: JSON.stringify(input),
        text: { format: { type: "json_object" } },
        store: false,
        metadata: { purpose: "forgetResolve" },
      };
      const result = await withDeadline(deps.openai.call("responses.create", body), FORGET_RESOLVE_DEADLINE_MS, deps.timers);
      if (!isResponses(result) || result.status !== "completed" || result.refusal !== null || result.outputText === null) throw new Error("forget resolve: no answer");
      return JSON.parse(result.outputText) as unknown;
    },
  };
}
