/**
 * The call-closing port (spec §8 step 3; contracts §8 step 3; brief 047 ruling 7). The forget executor asks it to
 * hang up every registered call of a Session and records the answer: `closed`, `failed`, or nothing (an answer it
 * could not get). Only `closed` counts. A call that is not confirmed closed is asked again and blocks completion:
 * resume never clears a barrier while a call may still be open. The real hang-up is brief 048's; tests give the
 * executor the fake below. Nothing here places or ends a real call.
 */
import type { ID } from "@franki/core";

export type CallCloseAnswer = "closed" | "failed" | undefined;

export interface CallClosePort {
  /** Hang up every call registered to `sessionId`. Anything thrown counts as no answer. */
  close(req: { sessionId: ID; callIds: readonly string[] }): Promise<CallCloseAnswer>;
}

export interface FakeCallClose extends CallClosePort {
  calls: { sessionId: ID; callIds: readonly string[] }[];
}

/** A fake that answers with `answer(sessionId, attempt)`, recording every request. */
export function fakeCallClose(answer: (sessionId: ID, attempt: number) => CallCloseAnswer = () => "closed"): FakeCallClose {
  const calls: FakeCallClose["calls"] = [];
  return {
    calls,
    async close(req) {
      calls.push(req);
      return answer(req.sessionId, calls.filter((c) => c.sessionId === req.sessionId).length);
    },
  };
}

/** With no port, nothing is ever confirmed closed, so no forget completes (fails closed). */
export const NO_CALL_CLOSE: CallClosePort = { close: async () => undefined };
