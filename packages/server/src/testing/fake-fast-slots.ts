/**
 * Fake_FastSlots (brief 012 task A4): a scripted FastSlots port with no network and no cost. It records every input
 * and answers from its queue, then from `always`, and by default with `transport`, so a route that calls it by
 * mistake fails closed. `never` leaves the call pending until the caller's deadline, on the fake timers.
 */
import type { FastSlotsInput, FastSlotsResult } from "@franki/core";
import type { Timers } from "../clock/timers";
import type { FastSlotsPort } from "../onturn/fast-slots-port";

export type FakeSlotsAnswer = FastSlotsResult | { kind: "never" };

export class FakeFastSlots implements FastSlotsPort {
  readonly calls: { input: FastSlotsInput; deadlineMs: number }[] = [];
  private readonly queue: FakeSlotsAnswer[] = [];
  private fallback: FakeSlotsAnswer = { kind: "transport", ms: 0 };

  constructor(private readonly timers?: Timers) {}

  /** Queues answers, used once each, in order. */
  script(...answers: FakeSlotsAnswer[]): this {
    this.queue.push(...answers);
    return this;
  }

  /** The answer once the queue is empty. */
  always(answer: FakeSlotsAnswer): this {
    this.fallback = answer;
    return this;
  }

  slots(input: FastSlotsInput, deadlineMs: number): Promise<FastSlotsResult> {
    this.calls.push({ input: structuredClone(input) as FastSlotsInput, deadlineMs });
    const a = this.queue.shift() ?? this.fallback;
    if (a.kind !== "never") return Promise.resolve(structuredClone(a));
    if (this.timers === undefined) return new Promise<FastSlotsResult>(() => {});
    return this.timers.sleep(deadlineMs).then(() => ({ kind: "timeout", ms: deadlineMs }));
  }
}
