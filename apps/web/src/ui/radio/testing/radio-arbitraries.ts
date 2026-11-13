// Generators for the ui.radio property tests (brief 047). Test-only: nothing in the app imports this file.
import fc from "fast-check";
import { INITIAL_RADIO, type RadioEvent, type RadioReport, type RadioState, radioStep } from "../radio-machine";
import type { Station } from "../types";

const REPORTS: readonly RadioReport[] = ["playing", "waiting", "failed", "blocked", "timedOut"];

/** 0 to 8 stations with unique ids, sorted by longitude, some of them rock. */
export const stationsArb = (minLength = 0): fc.Arbitrary<readonly Station[]> =>
  fc
    .uniqueArray(
      fc.record({ id: fc.stringMatching(/^[a-f0-9]{4}$/), lon: fc.integer({ min: -180, max: 180 }), rock: fc.boolean() }),
      { minLength, maxLength: 8, selector: (s) => s.id },
    )
    .map((rows) =>
      rows
        .map(
          (r): Station => ({ id: r.id, name: `Station ${r.id}`, city: `City ${r.id}`, country: "Land", lat: 0, lon: r.lon, url: `https://radio.test/${r.id}`, rock: r.rock }),
        )
        .sort((a, b) => a.lon - b.lon),
    );

/**
 * One step of a run. A player report names its tune relative to the machine's current one (0 is current, a
 * negative number is stale), so runs reach the interesting answers; `tuneTo` names a station by index.
 */
export type RadioMove =
  | { move: "event"; event: RadioEvent }
  | { move: "player"; delta: number; report: RadioReport }
  | { move: "tuneTo"; index: number };

const pick = fc.double({ min: 0, max: 1, noNaN: true });

export const eventArb: fc.Arbitrary<RadioEvent> = fc.oneof(
  pick.map((p): RadioEvent => ({ kind: "press", pick: p })),
  fc.constant<RadioEvent>({ kind: "closePanel" }),
  fc.constant<RadioEvent>({ kind: "powerOff" }),
  fc.string({ maxLength: 4 }).map((id): RadioEvent => ({ kind: "tune", stationId: id })),
  fc.constantFrom<1 | -1>(1, -1).map((d): RadioEvent => ({ kind: "step", direction: d })),
  pick.map((p): RadioEvent => ({ kind: "spin", pick: p })),
  fc.oneof(fc.double(), fc.double({ min: 0, max: 1 })).map((v): RadioEvent => ({ kind: "setVolume", volume: v })),
  fc.constant<RadioEvent>({ kind: "retry" }),
  pick.map((p): RadioEvent => ({ kind: "rockPhrase", pick: p })),
  fc.constant<RadioEvent>({ kind: "offPhrase" }),
  fc.constantFrom<RadioEvent>({ kind: "duck", level: "none" }, { kind: "duck", level: "call" }, { kind: "duck", level: "speech" }),
);

export const moveArb: fc.Arbitrary<RadioMove> = fc.oneof(
  { weight: 3, arbitrary: eventArb.map((event): RadioMove => ({ move: "event", event })) },
  { weight: 3, arbitrary: fc.record({ delta: fc.integer({ min: -2, max: 0 }), report: fc.constantFrom(...REPORTS) }).map((r): RadioMove => ({ move: "player", ...r })) },
  { weight: 1, arbitrary: fc.nat({ max: 9 }).map((index): RadioMove => ({ move: "tuneTo", index })) },
);

/** The event a move makes in state `s`. */
export function eventOf(m: RadioMove, s: RadioState, stations: readonly Station[]): RadioEvent {
  switch (m.move) {
    case "event":
      return m.event;
    case "player":
      return { kind: "player", tune: s.tune + m.delta, report: m.report };
    case "tuneTo":
      return { kind: "tune", stationId: stations[m.index % Math.max(1, stations.length)]?.id ?? "none" };
  }
}

/** Every state of a run from the initial state, the initial one first. */
export function run(moves: readonly RadioMove[], stations: readonly Station[]): RadioState[] {
  const states = [INITIAL_RADIO];
  let s = INITIAL_RADIO;
  for (const m of moves) {
    s = radioStep(s, eventOf(m, s, stations), stations);
    states.push(s);
  }
  return states;
}
