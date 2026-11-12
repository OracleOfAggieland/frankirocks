import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { lookFor } from "../avatar/look";
import { LANDING } from "../copy-landing";
import { EVENT_MS } from "../motion";
import { planVoice, speechMs } from "./demo-voice";
import { FORGOTTEN_ID } from "./sample";
import {
  CLEAR_FRAMES,
  type DriverState,
  type SceneFranki,
  TOY_CELEBRATE_EVERY_MS,
  WAKE_WAIT_MS,
  allScenes,
  asleepInput,
  beatAt,
  driverInput,
  driverStep,
  freshClock,
  initialDriver,
  showsSample,
  stageBeats,
  stageFor,
  stepClock,
  wakeDecision,
} from "./stage-script";
import { STEP_IDS, STEP_SECTION, type StepId, TOY_STATES } from "./steps";

const LOOP: StepId[] = STEP_IDS.filter((s) => STEP_SECTION[s] === "loop");
const step = fc.constantFrom(...STEP_IDS);
const toy = fc.constantFrom(...TOY_STATES);
const beat = fc.integer({ min: -3, max: 6 });

describe("stageFor, step by step", () => {
  it("hero: Franki alone with the one fig label, no sample data", () => {
    const s = stageFor("hero", "listening");
    expect(s.fig).toEqual({ n: "1", text: LANDING.hero.alive });
    expect(s.plate).toBe(false);
    expect(s.layout).toBe("solo");
    expect(s.franki.state).toBe("listening");
  });

  it("talk: the toy, and Franki in the state picked", () => {
    expect(stageFor("talk", "thinking").franki.state).toBe("thinking");
    expect(stageFor("talk", "muted").franki.micMuted).toBe(true);
    expect(stageFor("talk", "celebrate").franki.event).toEqual({ kind: "celebrate", key: "toy", repeatMs: TOY_CELEBRATE_EVERY_MS });
    const s = stageFor("talk", "listening");
    expect(s.toy).toBe(true);
    expect(s.plate).toBe(false);
    expect(s.layout).toBe("toy");
  });

  it("noticed and connected: the first terminals and the source tags, joined at connected", () => {
    const n = stageFor("noticed", "listening");
    expect(n.strip.filled).toBe(1);
    expect(n.tags).toEqual(["bank"]);
    expect(n.wire).toBe(false);
    expect(n.franki.event).toEqual({ kind: "present-card", key: "noticed" });
    const c = stageFor("connected", "listening");
    expect(c.strip.filled).toBe(2);
    expect(c.tags).toEqual(["bank", "calendar"]);
    expect(c.wire).toBe(true);
    expect(c.franki.state).toBe("thinking");
  });

  it("suggested: Franki says the line with the source card, then listens", () => {
    const speak = stageFor("suggested", "listening", 0);
    expect(speak.strip.filled).toBe(3);
    expect(speak.cards).toEqual(["takeout"]);
    expect(speak.line).toBe(LANDING.steps.suggested.says);
    expect(speak.franki).toMatchObject({ state: "speaking", speaking: true });
    const after = stageFor("suggested", "listening", 1);
    expect(after.line).toBeNull();
    expect(after.franki).toMatchObject({ state: "listening", speaking: false });
    expect(stageBeats("suggested")[1]).toBeGreaterThanOrEqual(speechMs(LANDING.steps.suggested.says));
  });

  it("approve, yes, result: the approval waits for a yes, the list follows, the win celebrates", () => {
    const a = stageFor("approve", "listening");
    expect(a.cards[0]).toBe("dinners");
    expect(a.approval).toBe("dinners");
    expect(a.franki.event).toEqual({ kind: "await-approval", approvalId: "dinners" });
    const y = stageFor("yes", "listening");
    expect(y.strip.filled).toBe(4);
    expect(y.cards[0]).toBe("list");
    expect(y.approval).toBeNull();
    const r = stageFor("result", "listening");
    expect(r.strip.filled).toBe(5);
    expect(r.cards[0]).toBe("weeks");
    expect(r.franki.event).toEqual({ kind: "celebrate", key: "result" });
  });

  it("jar, know, forget: the jar and Lab, the sheet, then one item gone and the receipt", () => {
    const j = stageFor("jar", "listening");
    expect(j).toMatchObject({ jar: true, lab: true, sheet: false, receipt: false });
    expect(j.strip.open).toBe(false);
    expect(stageFor("know", "listening")).toMatchObject({ sheet: true, panel: "sheet", forgotten: null });
    const f0 = stageFor("forget", "listening", 0);
    expect(f0).toMatchObject({ sheet: true, forgotten: FORGOTTEN_ID, receipt: false });
    expect(f0.franki.state).toBe("thinking");
    const f1 = stageFor("forget", "listening", 1);
    expect(f1).toMatchObject({ sheet: false, lab: true, receipt: true, forgotten: FORGOTTEN_ID });
    expect(f1.franki.state).toBe("listening");
  });

  it("beats: a step is on its last beat once that beat's time has come", () => {
    expect(beatAt("forget", 0)).toBe(0);
    expect(beatAt("forget", stageBeats("forget")[1])).toBe(1);
    expect(beatAt("noticed", 1e9)).toBe(0);
  });
});

describe("stageFor, properties", () => {
  it("the strip never goes backwards through the loop", () => {
    fc.assert(
      fc.property(toy, beat, beat, (t, b1, b2) => {
        for (let i = 1; i < LOOP.length; i++) {
          const prev = stageFor(LOOP[i - 1], t, b1);
          const next = stageFor(LOOP[i], t, b2);
          expect(next.strip.open).toBe(true);
          expect(next.strip.filled).toBeGreaterThanOrEqual(prev.strip.filled);
        }
      }),
    );
  });

  it("the plate shows whenever any sample datum shows, and only then", () => {
    fc.assert(
      fc.property(step, toy, beat, (s, t, b) => {
        const scene = stageFor(s, t, b);
        expect(scene.plate).toBe(showsSample(scene));
        expect(scene.frame).toBe(scene.plate);
      }),
    );
  });

  it("the receipt shows only at forget", () => {
    fc.assert(
      fc.property(step, toy, beat, (s, t, b) => {
        if (stageFor(s, t, b).receipt) expect(s).toBe("forget");
      }),
    );
  });

  it("only the approval card's Yes works, at approve, with the card in front", () => {
    fc.assert(
      fc.property(step, toy, beat, (s, t, b) => {
        const scene = stageFor(s, t, b);
        if (scene.approval !== null) {
          expect(s).toBe("approve");
          expect(scene.cards[0]).toBe(scene.approval);
        }
        expect(scene.cards.length).toBeLessThanOrEqual(3);
      }),
    );
  });

  it("the toy shows only at talk, and the pick changes nothing outside it", () => {
    fc.assert(
      fc.property(step, toy, toy, beat, (s, t1, t2, b) => {
        expect(stageFor(s, t1, b).toy).toBe(s === "talk");
        if (s !== "talk") expect(stageFor(s, t1, b)).toEqual(stageFor(s, t2, b));
      }),
    );
  });

  it("every scene gives Franki a valid look, with no event before the driver fires one", () => {
    for (const scene of allScenes(TOY_STATES)) {
      const input = driverInput(initialDriver, scene.franki, { reduced: false, outputLevel: 0 });
      expect(lookFor(input).name).toBe("Dormant");
    }
  });
});

// ---- The step clock ----

describe("stepClock", () => {
  const plan = planVoice(LANDING.steps.suggested.says);
  const planFor = (s: StepId) => (s === "suggested" ? plan : null);
  const tick = (c: ReturnType<typeof freshClock>, s: StepId, entry: number, at: number) => stepClock(c, { step: s, entry, at, plan: planFor(s) });

  it("counts the line, then the second beat; returns the same clock while nothing changes", () => {
    let c = tick(freshClock("suggested", 0), "suggested", 0, 1000);
    expect(c).toMatchObject({ step: "suggested", entry: 0, enteredAt: 1000, beat: 0, spoken: 0 });
    expect(tick(c, "suggested", 0, 1001)).toBe(c);
    c = tick(c, "suggested", 0, 1000 + stageBeats("suggested")[1]!);
    expect(c.beat).toBe(1);
    expect(c.spoken).toBe(plan.words.length);
  });

  it("starts the line again on coming back to a step whose second beat has passed", () => {
    // The sentence ends, the visitor goes on and comes back: Franki says it again from the start.
    let c = tick(freshClock("suggested", 0), "suggested", 0, 0);
    c = tick(c, "suggested", 0, 60_000);
    expect(c.beat).toBe(1);
    c = tick(c, "approve", 1, 60_100);
    c = tick(c, "suggested", 2, 60_200);
    expect(c).toMatchObject({ step: "suggested", entry: 2, enteredAt: 60_200, beat: 0, spoken: 0 });
  });

  it("property: every new visit starts at beat 0 with no words said, whatever came before", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ step, dt: fc.integer({ min: 1, max: 20_000 }), stay: fc.integer({ min: 0, max: 5 }) }), { minLength: 1, maxLength: 20 }),
        (visits) => {
          let c = freshClock("hero", 0);
          let at = 0;
          let entry = 0;
          for (const v of visits) {
            entry += 1;
            at += v.dt;
            c = tick(c, v.step, entry, at);
            expect(c).toMatchObject({ step: v.step, entry, enteredAt: at, beat: 0, spoken: 0 });
            for (let i = 0; i < v.stay; i++) {
              at += v.dt;
              c = tick(c, v.step, entry, at);
              expect(c.beat).toBe(beatAt(v.step, at - c.enteredAt!));
            }
          }
        },
      ),
    );
  });
});

// ---- The driver ----

const LISTEN: SceneFranki = { state: "listening", micMuted: false, event: null, speaking: false };

function run(frames: { franki: SceneFranki; phase?: string | null; reduced?: boolean; dt?: number }[], from: DriverState = initialDriver, at0 = 0) {
  let s = from;
  let at = at0;
  const seen: DriverState[] = [];
  for (const f of frames) {
    at += f.dt ?? 16;
    s = driverStep(s, { at, franki: f.franki, phase: f.phase ?? "three", reduced: f.reduced ?? false });
    seen.push(s);
  }
  return { s, seen, at };
}

const repeat = <T,>(n: number, x: T): T[] => Array.from({ length: n }, () => x);

describe("wakeDecision", () => {
  it("wakes once three.js shows or will never show, waits otherwise, and is simply awake under reduced motion", () => {
    expect(wakeDecision("three", 0, false)).toBe("wake");
    expect(wakeDecision("failed", 0, false)).toBe("wake");
    expect(wakeDecision("loading", 0, false)).toBe("wait");
    expect(wakeDecision("svg", 0, false)).toBe("wait");
    expect(wakeDecision("loading", WAKE_WAIT_MS, false)).toBe("wake");
    expect(wakeDecision("loading", 0, true)).toBe("awake");
  });
});

describe("driverStep", () => {
  it("sleeps until the engine shows, then wakes once and listens", () => {
    const { s: asleep } = run(repeat(5, { franki: LISTEN, phase: "loading" }));
    expect(asleep.awake).toBe(false);
    expect(lookFor(driverInput(asleep, LISTEN, { reduced: false, outputLevel: 0 })).name).toBe("Dormant");
    const { s: waking, at } = run([{ franki: LISTEN, phase: "three" }], asleep, 80);
    expect(lookFor(driverInput(waking, LISTEN, { reduced: false, outputLevel: 0 })).name).toBe("Waking");
    const { s: awake } = run([{ franki: LISTEN, dt: EVENT_MS.wake + 16 }], waking, at);
    const input = driverInput(awake, LISTEN, { reduced: false, outputLevel: 0 });
    expect(lookFor(input).name).toBe("Listening");
    expect(input.attend).toBe("pointer");
  });

  it("under reduced motion is simply awake, with no wake", () => {
    const { s } = run([{ franki: LISTEN, phase: "svg", reduced: true }]);
    expect(s.awake).toBe(true);
    expect(s.events.timed).toBeNull();
    expect(lookFor(driverInput(s, LISTEN, { reduced: true, outputLevel: 0 })).name).toBe("Listening");
  });

  it("holds a one-shot until the wake ends", () => {
    const glance: SceneFranki = { ...LISTEN, event: { kind: "present-card", key: "noticed" } };
    const { s } = run([{ franki: glance }, ...repeat(10, { franki: glance })]);
    expect(s.events.timed?.event).toBe("wake");
    expect(s.fired).toBeNull();
    const { seen } = run(repeat(5, { franki: glance, dt: 300 }), s, 200);
    expect(seen.some((st) => st.events.timed?.event === "present-card")).toBe(true);
    expect(seen.at(-1)?.fired?.key).toBe("present-card:noticed");
  });

  it("goes to no event before replaying a celebrate that is still running", () => {
    const party: SceneFranki = { ...LISTEN, event: { kind: "celebrate", key: "result" } };
    // Awake, past the wake, then the celebrate fires.
    const awake = run([{ franki: LISTEN }, { franki: LISTEN, dt: EVENT_MS.wake + 16 }]);
    const fired = run([{ franki: party }], awake.s, awake.at);
    expect(fired.s.events.timed?.event).toBe("celebrate");
    // Leave and come straight back while it still runs.
    const away = run([{ franki: LISTEN }], fired.s, fired.at);
    const back = run(repeat(CLEAR_FRAMES + 1, { franki: party }), away.s, away.at);
    const events = back.seen.map((st) => currentName(st, party));
    expect(events[0]).toBe("Listening");
    expect(events.at(-1)).toBe("Celebrate");
  });

  it("cuts a running celebrate when the scene stops asking for it, so the scene's own state shows next frame", () => {
    const party: SceneFranki = { ...LISTEN, event: { kind: "celebrate", key: "toy", repeatMs: TOY_CELEBRATE_EVERY_MS } };
    const thinking: SceneFranki = { ...LISTEN, state: "thinking" };
    const awake = run([{ franki: LISTEN }, { franki: LISTEN, dt: EVENT_MS.wake + 16 }]);
    const fired = run([{ franki: party }], awake.s, awake.at);
    expect(currentName(fired.s, party)).toBe("Celebrate");
    const listening = run([{ franki: LISTEN }], fired.s, fired.at);
    expect(listening.s.events.timed).toBeNull();
    expect(currentName(listening.s, LISTEN)).toBe("Listening");
    const fired2 = run([{ franki: party }], awake.s, awake.at);
    const think = run([{ franki: thinking }], fired2.s, fired2.at);
    expect(think.s.events.timed).toBeNull();
    expect(currentName(think.s, thinking)).toBe(lookFor(driverInput(run([{ franki: thinking }], awake.s, awake.at).s, thinking, { reduced: false, outputLevel: 0 })).name);
  });

  it("property: once awake, a timed one-shot is never replaced by another without a frame of no event", () => {
    const franki = fc.constantFrom<SceneFranki>(
      LISTEN,
      { ...LISTEN, event: { kind: "celebrate", key: "result" } },
      { ...LISTEN, event: { kind: "celebrate", key: "toy", repeatMs: TOY_CELEBRATE_EVERY_MS } },
      { ...LISTEN, event: { kind: "present-card", key: "jar" } },
      { ...LISTEN, event: { kind: "present-card", key: "noticed" } },
      { ...LISTEN, event: { kind: "await-approval", approvalId: "dinners" } },
      { ...LISTEN, state: "thinking" },
    );
    fc.assert(
      fc.property(fc.array(fc.record({ franki, dt: fc.integer({ min: 1, max: 900 }) }), { minLength: 1, maxLength: 60 }), (frames) => {
        const { seen } = run([{ franki: LISTEN }, { franki: LISTEN, dt: EVENT_MS.wake + 16 }, ...frames]);
        let woke = 0;
        for (let i = 1; i < seen.length; i++) {
          const a = seen[i - 1].events.timed;
          const b = seen[i].events.timed;
          if (b?.event === "wake" && a?.event !== "wake") woke += 1;
          if (a !== null && b !== null && a.event !== "wake" && b.startedAt !== a.startedAt) {
            throw new Error(`a one-shot restarted in place: ${a.event} then ${b.event}`);
          }
        }
        expect(woke).toBe(0);
      }),
    );
  });

  it("an approval being waited for ends when the scene moves on", () => {
    const wait: SceneFranki = { ...LISTEN, event: { kind: "await-approval", approvalId: "dinners" } };
    const awake = run([{ franki: LISTEN }, { franki: LISTEN, dt: EVENT_MS.wake + 16 }]);
    const waiting = run([{ franki: wait }], awake.s, awake.at);
    expect(lookFor(driverInput(waiting.s, wait, { reduced: false, outputLevel: 0 })).name).toBe("Awaiting_Approval");
    const done = run([{ franki: LISTEN }], waiting.s, waiting.at);
    expect(done.s.events.awaiting).toBeNull();
  });

  it("speaks with the output level only while speaking, and the asleep input is Dormant", () => {
    const talk: SceneFranki = { ...LISTEN, state: "speaking", speaking: true };
    const awake = run([{ franki: LISTEN }, { franki: talk, dt: EVENT_MS.wake + 16 }]);
    expect(driverInput(awake.s, talk, { reduced: false, outputLevel: 0.7 }).outputLevel).toBeCloseTo(0.7);
    expect(lookFor(driverInput(awake.s, talk, { reduced: false, outputLevel: 0.7 })).name).toBe("Speaking");
    expect(driverInput(awake.s, LISTEN, { reduced: false, outputLevel: 2 }).outputLevel).toBe(1);
    expect(lookFor(asleepInput(true)).name).toBe("Dormant");
  });
});

function currentName(s: DriverState, franki: SceneFranki): string {
  return lookFor(driverInput(s, franki, { reduced: false, outputLevel: 0 })).name;
}
