// The engine half of the mapping (design note §2.2, §2.3): the appended setTargets block that turns `overlay` into
// channel targets, the arc gate, and applyTargets' one-shot commands, on the real createRig and createState with
// plain fakes for the scene parts they only reach through functions. No WebGL.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Acting } from "../../../ui/avatar/acting";
import { createConfig } from "./config";
import { createRandom } from "./math";
import { createProbes } from "./probe";
import { createRig } from "./rig";
import { createState } from "./state";

type RigRc = Parameters<typeof createRig>[0];
type StateRc = Parameters<typeof createState>[0];

const IDLE: Acting = { name: "Listening", pose: "idle", overlay: "none", oneShot: null, ghost: false, mic: false, voice: false, electric: true };
const NONE = { wake: "none", celebrate: "none" } as const;

function build({ still = false, T = 10 }: { still?: boolean; T?: number } = {}) {
  const clock = { T };
  const targets: Acting = { ...IDLE };
  const base = {
    clock, targets, ...createConfig({ still, quality: "auto" }), ...createRandom(), ...createProbes(),
    camera: new THREE.PerspectiveCamera(), eyes: [], head: new THREE.Group(), content: new THREE.Group(),
  };
  const rig = createRig(base as unknown as RigRc);
  const st = createState({ ...base, ...rig, arcs: { env: 0 } } as unknown as StateRc);
  /** One frame's target pass, as frameInner runs it (resolveState, then setTargets). */
  const targetsPass = (dt = 1 / 60) => {
    const { base: pose, muted } = st.resolveState(clock.T);
    st.setTargets(clock.T, dt, pose, muted);
  };
  return { clock, targets, rig, st, targetsPass };
}

describe("applyTargets: the wake", () => {
  it("start: plays from now, the doze spring hands over at 0, and the boot's blink and gaze timers are re-armed", () => {
    const { clock, rig, st } = build();
    rig.CH.doze.snap(1);
    rig.blink.doubleAt = clock.T + 0.3;
    rig.blink.next = clock.T + 0.4;
    rig.gaze.next = clock.T + 0.5;
    rig.wake.fired.add("strike");
    st.applyTargets({ ...IDLE, name: "Waking", oneShot: "wake" }, { wake: "start", celebrate: "none" });
    expect(rig.wake).toMatchObject({ active: true, t0: clock.T });
    expect(rig.wake.fired.size).toBe(0);
    expect([rig.CH.doze.v, rig.CH.doze.t]).toEqual([0, 0]);
    expect(rig.blink.doubleAt).toBe(-1);
    expect(rig.blink.next).toBeGreaterThanOrEqual(clock.T + 2.5);            // no timed blink before 2.5 s, past the eye-pop
    expect(rig.gaze.next).toBe(0);
  });

  it("before the strike the wake's pose is the doze pose at 1, so a cut can hand it over without a pop", () => {
    const { clock, rig, st } = build();
    st.applyTargets({ ...IDLE, name: "Waking", oneShot: "wake" }, { wake: "start", celebrate: "none" });
    for (const tw of [0, 0.1, 0.2, 0.3, 0.349]) {
      expect({ ...rig.wakeCurves(tw) }).toEqual({ closed: 1, glow: 0.2, sink: -0.15 });
    }
    // The doze terms in apply.ts at doze 1: Math.max(.., closed, 1) = 1, glow x lerp(1, 0.2, 1) = 0.2, sink -0.15 x 1.
    expect(clock.T).toBe(10);
  });

  it("cut before the strike ends the wake and leaves the doze spring holding the same pose, easing to the new look", () => {
    const { clock, rig, st, targetsPass } = build();
    st.applyTargets({ ...IDLE, name: "Waking", oneShot: "wake" }, { wake: "start", celebrate: "none" });
    clock.T += 0.2;
    st.applyTargets({ ...IDLE, name: "Recovery", overlay: "recovery" }, { wake: "cut", celebrate: "none" });
    expect(rig.wake.active).toBe(false);
    expect(rig.CH.doze.v).toBe(1);
    expect({ ...rig.wakeCurves(clock.T - rig.wake.t0) }).toEqual({ closed: 0, glow: 1, sink: 0 });
    targetsPass();
    expect(rig.CH.doze.t).toBe(0);                                            // Recovery: the doze eases out on its spring
    expect([rig.CH.up.t, rig.CH.tilt.t]).toEqual([0.30, -8]);
  });

  it("cut into Dormant keeps the doze at 1, so the ghost simply stays asleep", () => {
    const { clock, rig, st, targetsPass } = build();
    st.applyTargets({ ...IDLE, name: "Waking", oneShot: "wake" }, { wake: "start", celebrate: "none" });
    clock.T += 0.1;
    st.applyTargets({ ...IDLE, name: "Dormant", overlay: "dormant", electric: false }, { wake: "cut", celebrate: "none" });
    targetsPass();
    expect(rig.wake.active).toBe(false);
    expect([rig.CH.doze.v, rig.CH.doze.t]).toEqual([1, 1]);
  });

  it("cut after the strike lets the wake play out", () => {
    const { clock, rig, st } = build();
    st.applyTargets({ ...IDLE, name: "Waking", oneShot: "wake" }, { wake: "start", celebrate: "none" });
    clock.T += 0.5;
    rig.wake.fired.add("strike");
    st.applyTargets({ ...IDLE, name: "Dormant", overlay: "dormant" }, { wake: "cut", celebrate: "none" });
    expect(rig.wake.active).toBe(true);
    expect(rig.CH.doze.v).toBe(0);
  });

  it("cut with no wake playing changes nothing", () => {
    const { rig, st } = build();
    rig.CH.doze.snap(0.4);
    st.applyTargets({ ...IDLE }, { wake: "cut", celebrate: "none" });
    expect(rig.wake.active).toBe(false);
    expect(rig.CH.doze.v).toBe(0.4);
  });

  it("still mode ignores every command (still frames take their one-shots from stillOverride)", () => {
    const { rig, st } = build({ still: true });
    st.applyTargets({ ...IDLE, name: "Waking", oneShot: "wake" }, { wake: "start", celebrate: "start" });
    expect(rig.wake.active).toBe(false);
    expect(rig.celeb.active).toBe(false);
  });
});

describe("applyTargets: celebrate", () => {
  it("start plays from now; cut fades from now, once", () => {
    const { clock, rig, st } = build();
    st.applyTargets({ ...IDLE, name: "Celebrate", oneShot: "celebrate" }, { wake: "none", celebrate: "start" });
    expect(rig.celeb).toMatchObject({ active: true, t0: clock.T, cutAt: -1 });
    clock.T += 0.5;
    st.applyTargets({ ...IDLE }, { wake: "none", celebrate: "cut" });
    expect(rig.celeb.cutAt).toBe(clock.T);
    clock.T += 0.1;
    st.applyTargets({ ...IDLE }, { wake: "none", celebrate: "cut" });
    expect(rig.celeb.cutAt).toBe(clock.T - 0.1);
  });

  it("writes targets in place and nothing else for NO_COMMAND", () => {
    const { targets, rig, st } = build();
    const before = targets;
    st.applyTargets({ ...IDLE, name: "Speaking", pose: "speaking", voice: true }, NONE);
    expect(targets).toBe(before);
    expect(targets).toMatchObject({ name: "Speaking", pose: "speaking", voice: true });
    expect(rig.wake.active || rig.celeb.active).toBe(false);
  });
});

describe("setTargets: the appended overlay block", () => {
  it("Recovery: worried lids, unless ghost", () => {
    const { st, rig, targetsPass } = build();
    st.applyTargets({ ...IDLE, name: "Recovery", overlay: "recovery" }, NONE);
    targetsPass();
    expect([rig.CH.up.t, rig.CH.tilt.t]).toEqual([0.30, -8]);
    st.applyTargets({ ...IDLE, name: "Recovery", overlay: "recovery", ghost: true }, NONE);
    targetsPass();
    expect([rig.CH.up.t, rig.CH.tilt.t]).toEqual([0.32, 4]);                 // the ghost's muted lids win
  });

  it("Awaiting_Approval: expectant lids and the nod weight, the lids yielding to ghost", () => {
    const { st, rig, targetsPass } = build();
    st.applyTargets({ ...IDLE, name: "Awaiting_Approval", pose: "thinking", overlay: "awaiting", electric: false }, NONE);
    targetsPass();
    expect([rig.CH.up.t, rig.CH.pupil.t, rig.CH.approve.t]).toEqual([0, 0.5, 1]);
    st.applyTargets({ ...IDLE, name: "Awaiting_Approval", pose: "thinking", overlay: "awaiting", ghost: true, electric: false }, NONE);
    targetsPass();
    expect(rig.CH.up.t).not.toBe(0);
    expect(rig.CH.approve.t).toBe(1);
    st.applyTargets({ ...IDLE }, NONE);
    targetsPass();
    expect(rig.CH.approve.t).toBe(0);
  });

  it("Dormant: the doze target, and the head and glint stilled", () => {
    const { st, rig, targetsPass } = build();
    st.applyTargets({ ...IDLE, name: "Dormant", overlay: "dormant", electric: false }, NONE);
    rig.CH.lookYaw.t = 5; rig.CH.headSac.t = 1;
    targetsPass();
    expect(rig.CH.doze.t).toBe(1);
    expect([rig.CH.lookYaw.t, rig.CH.lookPitch.t, rig.CH.headSac.t, rig.CH.glint.t]).toEqual([0, 0, 0, 0]);
    st.applyTargets({ ...IDLE }, NONE);
    targetsPass();
    expect(rig.CH.doze.t).toBe(0);
  });

  it("the arc gate: no arcs over thinking without the look's electricity", () => {
    const { clock, st, rig, targetsPass } = build();
    st.applyTargets({ ...IDLE, name: "Thinking", pose: "thinking", electric: true }, NONE);
    targetsPass();
    clock.T += 0.2;
    targetsPass();
    expect(rig.CH.arc.t).toBe(1);
    st.applyTargets({ ...IDLE, name: "Presenting", pose: "thinking", electric: false }, NONE);
    targetsPass();
    expect(rig.CH.arc.t).toBe(0);
  });
});
