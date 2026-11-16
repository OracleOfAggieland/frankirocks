// Generators for the ui.xray property tests (brief 051). Test-only: nothing in the app imports this file.
import fc from "fast-check";
import { INITIAL_XRAY, type XrayEvent, type XrayState, type XrayStepResult, xrayStep } from "../xray-machine";

const CAMERA_FAILS = ["blocked", "noCamera", "ended"] as const;
const TRACKER_REPORTS = ["ready", "failed", "timedOut", "found", "lost"] as const;

/**
 * One step of a run. A camera or tracker report names its session relative to the machine's current one (0 is
 * current, a negative number is stale), so runs reach the interesting answers.
 */
export type XrayMove =
  | { move: "event"; event: XrayEvent }
  | { move: "opened"; delta: number; cameras: number }
  | { move: "cameraFail"; delta: number; report: (typeof CAMERA_FAILS)[number] }
  | { move: "tracker"; delta: number; report: (typeof TRACKER_REPORTS)[number] };

export const plainEventArb: fc.Arbitrary<XrayEvent> = fc.constantFrom<XrayEvent>(
  { kind: "press" },
  { kind: "close" },
  { kind: "flip" },
  { kind: "retry" },
  { kind: "hidden" },
  { kind: "shown" },
);

const delta = fc.integer({ min: -2, max: 0 });

export const moveArb: fc.Arbitrary<XrayMove> = fc.oneof(
  { weight: 4, arbitrary: plainEventArb.map((event): XrayMove => ({ move: "event", event })) },
  { weight: 2, arbitrary: fc.record({ delta, cameras: fc.oneof(fc.integer({ min: -1, max: 4 }), fc.constant(Number.NaN)) }).map((r): XrayMove => ({ move: "opened", ...r })) },
  { weight: 1, arbitrary: fc.record({ delta, report: fc.constantFrom(...CAMERA_FAILS) }).map((r): XrayMove => ({ move: "cameraFail", ...r })) },
  { weight: 3, arbitrary: fc.record({ delta, report: fc.constantFrom(...TRACKER_REPORTS) }).map((r): XrayMove => ({ move: "tracker", ...r })) },
);

/** Any report naming an older session than `s`'s, `back` sessions back (back >= 1). */
export const staleReportArb = (back: fc.Arbitrary<number> = fc.integer({ min: 1, max: 4 })) =>
  fc.oneof(
    fc.record({ back, cameras: fc.integer({ min: 0, max: 4 }) }).map((r) => (s: XrayState): XrayEvent => ({ kind: "camera", session: s.session - r.back, report: "opened", cameras: r.cameras })),
    fc.record({ back, report: fc.constantFrom(...CAMERA_FAILS) }).map((r) => (s: XrayState): XrayEvent => ({ kind: "camera", session: s.session - r.back, report: r.report })),
    fc.record({ back, report: fc.constantFrom(...TRACKER_REPORTS) }).map((r) => (s: XrayState): XrayEvent => ({ kind: "tracker", session: s.session - r.back, report: r.report })),
  );

/** The event a move makes in state `s`. */
export function eventOf(m: XrayMove, s: XrayState): XrayEvent {
  switch (m.move) {
    case "event":
      return m.event;
    case "opened":
      return { kind: "camera", session: s.session + m.delta, report: "opened", cameras: m.cameras };
    case "cameraFail":
      return { kind: "camera", session: s.session + m.delta, report: m.report };
    case "tracker":
      return { kind: "tracker", session: s.session + m.delta, report: m.report };
  }
}

/** Every step of a run from the initial state: the event, the state before and the result. */
export function runSteps(moves: readonly XrayMove[]): { before: XrayState; event: XrayEvent; result: XrayStepResult }[] {
  const out: { before: XrayState; event: XrayEvent; result: XrayStepResult }[] = [];
  let s = INITIAL_XRAY;
  for (const m of moves) {
    const event = eventOf(m, s);
    const result = xrayStep(s, event);
    out.push({ before: s, event, result });
    s = result.state;
  }
  return out;
}

/** Every state of a run from the initial state, the initial one first. */
export function run(moves: readonly XrayMove[]): XrayState[] {
  return [INITIAL_XRAY, ...runSteps(moves).map((x) => x.result.state)];
}
