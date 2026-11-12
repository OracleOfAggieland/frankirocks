// A test driver for the visit machine (brief 027's properties). Tests only. It plays an honest server and a
// browser that reloads: storage keeps what `store` wrote, a reload starts a fresh machine on it, and an answer goes
// only to the request that is outstanding, or replays an earlier answer late.
import fc from "fast-check";
import { INITIAL_VISIT, type StoredVisit, type VisitCommand, type VisitEvent, type VisitState, visitStep } from "./visit-machine";

export type VisitAction =
  | { a: "reload" }
  | { a: "answerReset"; outcome: "ok" | "barrier" | "timeout" | "failed"; worldMs: number }
  | { a: "answerAdvance"; outcome: "ok" | "barrier" | "timeout" | "failed"; retryAfterMs: number }
  | { a: "replay"; pick: number }
  | { a: "retry" }
  | { a: "askStartOver" }
  | { a: "cancel" }
  | { a: "confirm"; inCall: boolean }
  | { a: "callEnded" }
  | { a: "press"; offsetMs: number }
  | { a: "pressAt"; atMs: number }
  | { a: "waitOver" };

const WORLD = fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 });

export const arbVisitAction: fc.Arbitrary<VisitAction> = fc.oneof(
  fc.constant({ a: "reload" as const }),
  fc.record({ a: fc.constant("answerReset" as const), outcome: fc.constantFrom("ok" as const, "barrier" as const, "timeout" as const, "failed" as const), worldMs: WORLD }),
  fc.record({ a: fc.constant("answerAdvance" as const), outcome: fc.constantFrom("ok" as const, "barrier" as const, "timeout" as const, "failed" as const), retryAfterMs: fc.integer({ min: 0, max: 5000 }) }),
  fc.record({ a: fc.constant("replay" as const), pick: fc.nat() }),
  fc.constant({ a: "retry" as const }),
  fc.constant({ a: "askStartOver" as const }),
  fc.constant({ a: "cancel" as const }),
  fc.record({ a: fc.constant("confirm" as const), inCall: fc.boolean() }),
  fc.constant({ a: "callEnded" as const }),
  fc.record({ a: fc.constant("press" as const), offsetMs: fc.integer({ min: -86_400_000, max: 30 * 86_400_000 }) }),
  fc.record({ a: fc.constant("pressAt" as const), atMs: WORLD }),
  fc.constant({ a: "waitOver" as const }),
);

export interface TraceStep {
  /** The event the machine got, after which `state` holds. */
  event: VisitEvent;
  state: VisitState;
  commands: VisitCommand[];
  /** The world clock of the last current answer, before this step. */
  lastSeenBefore: number | null;
  /** The stored visit ID before this step. */
  storedIdBefore: string | null;
}

export interface Trace {
  steps: TraceStep[];
}

/** Runs the actions against the machine, with storage, reloads and an honest server. */
export function runVisit(actions: readonly VisitAction[]): Trace {
  let storage: StoredVisit | null = null;
  let state: VisitState = INITIAL_VISIT;
  let outstandingReset: { seq: number } | null = null;
  let outstandingAdvance: { seq: number; toMs: number } | null = null;
  let lastSeen: number | null = null;
  let ids = 0;
  const delivered: VisitEvent[] = [];
  const steps: TraceStep[] = [];

  const feed = (event: VisitEvent) => {
    const lastSeenBefore = lastSeen;
    const storedIdBefore = storage?.visitId ?? null;
    const out = visitStep(state, event);
    state = out.state;
    for (const c of out.commands) {
      if (c.kind === "store") storage = { ...c.visit };
      if (c.kind === "reset") {
        outstandingReset = { seq: c.seq };
        outstandingAdvance = null;
      }
      if (c.kind === "advance") outstandingAdvance = { seq: c.seq, toMs: c.toMs };
    }
    steps.push({ event, state, commands: out.commands, lastSeenBefore, storedIdBefore });
  };
  const enter = () => feed({ kind: "entered", stored: storage === null ? null : { ...storage }, newVisitId: `visit-${++ids}` });

  enter();
  for (const act of actions) {
    switch (act.a) {
      case "reload":
        state = INITIAL_VISIT;
        outstandingReset = null;
        outstandingAdvance = null;
        // A reload drops every request in flight with the page, so nothing from before it can arrive after it.
        delivered.length = 0;
        enter();
        break;
      case "answerReset": {
        if (outstandingReset === null) break;
        const { seq } = outstandingReset;
        outstandingReset = null;
        const e: VisitEvent =
          act.outcome === "ok" ? { kind: "resetAnswered", seq, fixtureNamespace: `ns-${seq}`, worldMs: act.worldMs } : { kind: "resetFailed", seq, why: act.outcome };
        if (act.outcome === "ok") lastSeen = act.worldMs;
        delivered.push(e);
        feed(e);
        break;
      }
      case "answerAdvance": {
        if (outstandingAdvance === null) break;
        const { seq, toMs } = outstandingAdvance;
        outstandingAdvance = null;
        const e: VisitEvent =
          act.outcome === "ok" ? { kind: "advanceAnswered", seq, worldMs: toMs, proactive: null } : { kind: "advanceFailed", seq, why: act.outcome, retryAfterMs: act.retryAfterMs };
        if (act.outcome === "ok") lastSeen = toMs;
        delivered.push(e);
        feed(e);
        break;
      }
      case "replay":
        // A late copy of an earlier answer: never current any more.
        if (delivered.length > 0) feed(delivered[act.pick % delivered.length]!);
        break;
      case "retry":
        feed({ kind: "retry" });
        break;
      case "askStartOver":
        feed({ kind: "startOverAsked" });
        break;
      case "cancel":
        feed({ kind: "startOverCancelled" });
        break;
      case "confirm":
        feed({ kind: "startOverConfirmed", inCall: act.inCall });
        break;
      case "callEnded":
        feed({ kind: "callEnded" });
        break;
      case "press":
        feed({ kind: "boltPressed", toMs: (lastSeen ?? 1_800_000_000_000) + act.offsetMs });
        break;
      case "pressAt":
        feed({ kind: "boltPressed", toMs: act.atMs });
        break;
      case "waitOver":
        feed({ kind: "waitOver" });
        break;
    }
  }
  return { steps };
}

export const arbVisitActions = fc.array(arbVisitAction, { maxLength: 40 });
