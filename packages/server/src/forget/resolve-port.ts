/**
 * The ForgetResolveV1 port (contracts §5). The model only reads and names the scope; `checkResolve` in
 * `@franki/core` decides what its answer may do. No live implementation exists in this part: the executor is
 * given a port, and tests give it the fake below. Nothing here calls a paid model.
 */
import type { ForgetResolveInputV1 } from "@franki/core";

export interface ForgetResolvePort {
  /** The model's raw answer. Anything thrown is a retry; anything returned is checked by code. */
  resolve(input: ForgetResolveInputV1): Promise<unknown>;
}

export interface FakeForgetResolve extends ForgetResolvePort {
  calls: ForgetResolveInputV1[];
}

/** A fake that answers with `answer(input)`, recording every input. */
export function fakeForgetResolve(answer: (input: ForgetResolveInputV1) => unknown): FakeForgetResolve {
  const calls: ForgetResolveInputV1[] = [];
  return {
    calls,
    async resolve(input) {
      calls.push(input);
      return answer(input);
    },
  };
}
