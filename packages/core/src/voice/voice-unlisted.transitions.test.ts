// The default branch of onRealtime (brief 014, V1 step 1). The Voice_Client hands the reducer any data-channel JSON
// with a string `type`, so Realtime types the union does not list do arrive. Titles read `<FROM> + <event> -> <TO>
// (<why>)`. These cases pin today's rule: an unlisted type changes nothing and does not throw.
import { describe, expect, it } from "vitest";
import { type VoiceEvent, type VoiceState, step } from "./machine";
import { type WideAction, WideDriver } from "./testing/arb-call-wide";

const play = (d: WideDriver, action: WideAction, dt = 0) => d.play({ action, dt });

/** A call brought to LISTENING through its own setup steps. */
function live(d = new WideDriver().start()): WideDriver {
  play(d, { k: "openOk" }, 300);
  play(d, { k: "channelOpen" }, 300);
  play(d, { k: "stateOk", variant: "fresh" }, 100);
  expect(d.st.phase).toBe("LISTENING");
  return d;
}

/** Speech, commit, the judge says O, the fastO Permit is checked: the speculative reply plays. */
function speaking(d = live()): WideDriver {
  const steps: [WideAction, number][] = [
    [{ k: "speechStart" }, 200],
    [{ k: "speechStop" }, 1_400],
    [{ k: "fire", name: "poll" }, 0],
    [{ k: "stateOk", variant: "fresh" }, 100],
    [{ k: "commit" }, 10],
    [{ k: "itemAdded", pick: 0 }, 50],
    [{ k: "created", pick: 1 }, 5],
    [{ k: "created", pick: 0 }, 5],
    [{ k: "hash", pick: 0, ok: true }, 0],
    [{ k: "judgeDone", pick: 0, letter: "O" }, 300],
    [{ k: "hash", pick: 0, ok: true }, 0],
    [{ k: "started", pick: 0 }, 200],
  ];
  for (const [a, dt] of steps) play(d, a, dt);
  expect(d.st.phase).toBe("SPEAKING");
  return d;
}

/** Types the Realtime server sends that the reducer's union does not list, and one made up. */
const UNLISTED = ["session.updated", "rate_limits.updated", "response.output_audio_transcript.delta", "madeUpEvent"];

const unlisted = (type: string): VoiceEvent =>
  ({ type: "realtime", event: { type }, freshId: "unlisted-1" }) as unknown as VoiceEvent;

function expectNoChange(st: VoiceState, now: number, type: string): void {
  const r = step(st, unlisted(type), now);
  expect(r.state).toBe(st);
  expect(r.commands).toEqual([]);
}

describe("unlisted Realtime types", () => {
  for (const type of UNLISTED) {
    it(`LISTENING + realtime ${type} -> LISTENING (unlisted: no state change, no command, no throw)`, () => {
      const d = live();
      expectNoChange(d.st, d.now, type);
    });

    it(`SPEAKING + realtime ${type} -> SPEAKING (unlisted: no state change, no command, no throw)`, () => {
      const d = speaking();
      expectNoChange(d.st, d.now, type);
    });
  }
});
