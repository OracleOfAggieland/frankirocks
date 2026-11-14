/**
 * A forget in a call, as the brief 048 server answers it (rulings 3 and 7). Plain module, test-only.
 *
 *   - `blocked` (from the swap driver): the forget's post is answered `blocked` with no Permit. The call swaps.
 *   - `barrier`: while the forget's barrier is up, the oldest waiting open answers `state: "blocked"`, with no Session.
 *   - Once the barrier is down, an open naming the forgotten Session answers with the acknowledgment in `proactive`
 *     (GONE_LINE, a `postCommitControl` Permit of scope `ack`), as `routes/open.ts` does.
 *   - `untilOpen`: while no open is waiting, the timer due first fires (at most 4), so a scene need not name the
 *     machine's own timers: the browser's next open goes out, if the machine sends one.
 */
import fc from "fast-check";
import type { TimerName } from "../machine";
import { type AckText, GONE_LINE } from "../lines";
import { judged } from "./arb-call-wide";
import { type SwapAction, SwapDriver, type SwapStep } from "./arb-swap";
import { arbSetup } from "./arb-call-wide";

export type ForgetAction = SwapAction | { k: "barrier" } | { k: "untilOpen" };
export interface ForgetStep {
  action: ForgetAction;
  dt: number;
}

const w = (action: ForgetAction, dt = 0): ForgetStep => ({ action, dt });

export class ForgetDriver extends SwapDriver {
  protected override swapLine: AckText = GONE_LINE;
  /** Steps at which a `barrier` answer was played. */
  barrierAt: number[] = [];

  override play(step: ForgetStep | SwapStep): void {
    const a = step.action as ForgetAction;
    if (a.k === "barrier") {
      this.sync();
      this.syncOpens();
      if (this.opensWaiting === 0) return;
      this.opensWaiting -= 1;
      this.opensPrev.shift();
      this.barrierAt.push(this.trace.steps.length);
      this.ev({ type: "openOk", response: { sessionId: this.fresh("sb"), generation: 0, deck: null, state: "blocked", ack: null, proactive: null, audience: null } }, step.dt);
      this.sync();
      return;
    }
    if (a.k === "untilOpen") {
      let dt = step.dt;
      for (let n = 0; n < 4; n++) {
        this.sync();
        if (this.opensWaiting > 0) return;
        const due = (Object.entries(this.st.deadlines) as [TimerName, number][]).sort((x, y) => x[1] - y[1])[0];
        if (due === undefined) return;
        super.play({ action: { k: "fire", name: due[0] }, dt });
        dt = 0;
      }
      return;
    }
    super.play(step as SwapStep);
  }
}

/** The most `barrier` answers a scene plays before the barrier comes down. */
export const BARRIERS_MAX = 6;

/** A post the forget is said in, its `blocked` answer, some barrier answers, then the fresh call coming up. */
const arbForgetScene: fc.Arbitrary<ForgetStep[]> = fc
  .record({
    lead: fc.constantFrom("slow", "typed", "fastO"),
    answerMs: fc.integer({ min: 50, max: 2_000 }),
    barriers: fc.array(fc.record({ openMs: fc.integer({ min: 50, max: 1_600 }), waitMs: fc.integer({ min: 0, max: 400 }) }), { maxLength: BARRIERS_MAX }),
    openMs: fc.integer({ min: 50, max: 900 }),
    lineEnds: fc.boolean(),
  })
  .map(({ lead, answerMs, barriers, openMs, lineEnds }) => {
    const transcript = w({ k: "transcript", pick: 0, fail: false, empty: false }, 300);
    const before: ForgetStep[] =
      lead === "typed"
        ? [w({ k: "typed" }, 300)]
        : lead === "fastO"
          ? [...(judged(1) as ForgetStep[]), w({ k: "judgeDone", pick: 0, letter: "O" }, 300), w({ k: "hash", pick: 0, ok: true }), w({ k: "started", pick: 0 }, 200), transcript]
          : [...(judged(1) as ForgetStep[]), w({ k: "judgeDone", pick: 0, letter: "H" }, 300), transcript];
    const waits = barriers.flatMap((b) => [w({ k: "barrier" }, b.openMs), w({ k: "untilOpen" }, b.waitMs)]);
    const up = [w({ k: "untilOpen" }), w({ k: "openOk" }, openMs), w({ k: "channelOpen" }, 200), w({ k: "stateOk", variant: "fresh" }, 100), w({ k: "stateOk", variant: "fresh" }, 50), w({ k: "hash", pick: 0, ok: true }), w({ k: "created", pick: 0 }, 30), w({ k: "started", pick: 0 }, 200)];
    const end = lineEnds ? [w({ k: "stopped" }, 1_500), w({ k: "done", pick: 0 })] : [w({ k: "speechStart" }, 400)];
    return [...before, w({ k: "blocked", pick: 0, care: false }, answerMs), ...waits, ...up, ...end];
  });

/** A call that is set up, then forgets. At most 80 steps. */
export const arbForgetCall: fc.Arbitrary<ForgetStep[]> = fc.tuple(arbSetup, arbForgetScene).map(([setup, scene]) => [...(setup as ForgetStep[]), ...scene].slice(0, 80));

export function runForgetCall(steps: readonly ForgetStep[]): ForgetDriver {
  const d = new ForgetDriver().start();
  for (const st of steps) d.play(st);
  return d;
}
