// The pointer follow of brief 015, on the real createRig with a plain camera, head and eye sockets. No WebGL.
// updateGaze is driven the way frameInner drives it: clock.T advances, the pointer handler's three writes are
// repeated by hand, and the channel targets are read back.
import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Acting, Pose } from "../../../ui/avatar/acting";
import { createConfig } from "./config";
import { createRandom } from "./math";
import { createProbes } from "./probe";
import { createRig } from "./rig";

type RigRc = Parameters<typeof createRig>[0];

const LISTENING: Acting = {
  name: "Listening", pose: "listening", overlay: "none", oneShot: null, ghost: false, mic: true, voice: false, electric: false,
};

function build({ follow = false, still = false, T = 10 }: { follow?: boolean; still?: boolean; T?: number } = {}) {
  const clock = { T };
  const targets: Acting = { ...LISTENING, followPointer: follow };
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
  camera.position.set(0, 0, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const content = new THREE.Group();
  const head = new THREE.Group();
  content.add(head);
  const eyes = [-1, 1].map((side) => {
    const socket = new THREE.Object3D();
    socket.position.set(0.1 * side, 0.3, 0.5);
    head.add(socket);
    return { socket };
  });
  const base = { clock, targets, ...createConfig({ still, quality: "auto" }), ...createRandom(), ...createProbes(), camera, eyes, head, content };
  const rig = createRig(base as unknown as RigRc);
  /** The pointer handler's writes (loop.ts onPointer), in canvas NDC. */
  const point = (x: number, y: number) => {
    rig.gaze.pointer.set(x, y);
    rig.gaze.pointerWin.set(x, y);
    rig.gaze.lastPointer = clock.T;
  };
  const frame = (pose: Pose, dt = 1 / 60) => {
    clock.T += dt;
    rig.updateGaze(clock.T, pose, false);
  };
  /** Every channel target and weight the gaze can write, and the gaze timers. */
  const snapshot = () => ({
    ch: rig.CH_LIST.map((c) => [c.t, c.w]),
    gaze: { ...rig.gaze, pointer: rig.gaze.pointer.toArray(), pointerWin: rig.gaze.pointerWin.toArray() },
    blink: { ...rig.blink },
  });
  return { clock, targets, rig, point, frame, snapshot };
}

describe("updateGaze: Listening follows the pointer (brief 015)", () => {
  it("without followPointer, a moving pointer never leaves the camera while listening", () => {
    const moved = build();
    const still = build();
    for (let i = 0; i < 240; i++) {
      moved.point(Math.sin(i / 20) * 0.9, Math.cos(i / 30) * 0.6);
      moved.frame("listening");
      still.frame("listening");
      expect(moved.snapshot().ch).toEqual(still.snapshot().ch);
    }
    expect(moved.rig.gaze.ptrLook).toBe(false);
  });

  it("with followPointer, the eyes and head turn toward the pointer on the frame it moves, and each side mirrors", () => {
    const right = build({ follow: true });
    right.point(0.9, 0);
    right.frame("listening");
    expect(right.rig.gaze.ptrLook).toBe(true);
    expect(right.rig.CH.gazeX.t).toBeGreaterThan(0.5);
    expect(right.rig.CH.lookYaw.t).toBeGreaterThan(5);

    const left = build({ follow: true });
    left.point(-0.9, 0);
    left.frame("listening");
    expect(left.rig.CH.gazeX.t).toBeLessThan(-0.5);
    expect(left.rig.CH.lookYaw.t).toBeLessThan(-5);
  });

  it("the head share stays inside the idle pose's limits however far the pointer goes", () => {
    const h = build({ follow: true });
    for (const [x, y] of [[40, 0], [-40, 0], [0, 40], [0, -40], [25, -25]]) {
      h.point(x!, y!);
      h.frame("listening");
      expect(Math.abs(h.rig.CH.lookYaw.t)).toBeLessThanOrEqual(12);
      expect(Math.abs(h.rig.CH.lookPitch.t)).toBeLessThanOrEqual(6);
      expect(Math.abs(h.rig.CH.gazeX.t)).toBeLessThanOrEqual(1.06);
      expect(Math.abs(h.rig.CH.gazeY.t)).toBeLessThanOrEqual(1.06);
    }
  });

  it("tracks the pointer live while it keeps moving", () => {
    const h = build({ follow: true });
    h.point(-0.8, 0);
    h.frame("listening");
    const before = h.rig.CH.lookYaw.t;
    for (let i = 0; i < 30; i++) {
      h.point(-0.8 + (1.6 * (i + 1)) / 30, 0);
      h.frame("listening");
    }
    expect(h.rig.gaze.ptrLook).toBe(true);
    expect(h.rig.CH.lookYaw.t).toBeGreaterThan(before);
    expect(h.rig.CH.lookYaw.t).toBeGreaterThan(5);
  });

  it("returns to the camera once the pointer has been still for 2.5 s", () => {
    const h = build({ follow: true });
    h.point(0.9, 0.4);
    h.frame("listening");
    expect(h.rig.gaze.ptrLook).toBe(true);
    // Still at 2.4 s: still looking at the pointer.
    for (let t = 0; t < 2.4; t += 1 / 60) h.frame("listening");
    expect(h.rig.gaze.ptrLook).toBe(true);
    expect(h.rig.CH.lookYaw.t).toBeGreaterThan(5);
    for (let t = 0; t < 0.2; t += 1 / 60) h.frame("listening");
    expect(h.rig.gaze.ptrLook).toBe(false);
    // The camera is straight ahead of the head: the head share is zero and the eyes sit near centre, micro-saccades aside.
    expect(h.rig.CH.lookYaw.t).toBeCloseTo(0, 6);
    expect(h.rig.CH.lookPitch.t).toBeCloseTo(0, 6);
    expect(Math.abs(h.rig.CH.gazeX.t)).toBeLessThan(0.2);
  });

  it("a pointer that moves again after the return is followed again at once", () => {
    const h = build({ follow: true });
    h.point(0.9, 0);
    h.frame("listening");
    for (let t = 0; t < 3; t += 1 / 60) h.frame("listening");
    expect(h.rig.gaze.ptrLook).toBe(false);
    h.point(-0.9, 0);
    h.frame("listening");
    expect(h.rig.gaze.ptrLook).toBe(true);
    expect(h.rig.CH.lookYaw.t).toBeLessThan(-5);
  });

  it("speaking and thinking keep their own gaze even with followPointer", () => {
    for (const pose of ["speaking", "thinking"] as const) {
      const on = build({ follow: true });
      const off = build();
      for (let i = 0; i < 120; i++) {
        on.point(0.9, 0.3);
        off.point(0.9, 0.3);
        on.frame(pose);
        off.frame(pose);
      }
      expect(on.snapshot()).toEqual(off.snapshot());
    }
  });

  it("followPointer turned off during a live follow returns the gaze to the camera on that frame", () => {
    const h = build({ follow: true });
    h.point(0.9, 0.4);
    h.frame("listening");
    expect(h.rig.gaze.ptrLook).toBe(true);
    expect(h.rig.CH.lookYaw.t).toBeGreaterThan(5);
    // The pointer is still live; only the acting changes, the way applyTargets writes it.
    h.point(0.9, 0.4);
    Object.assign(h.targets, { followPointer: false });
    h.frame("listening");
    expect(h.rig.gaze.ptrLook).toBe(false);
    expect(h.rig.CH.lookYaw.t).toBeCloseTo(0, 6);
    expect(h.rig.CH.lookPitch.t).toBeCloseTo(0, 6);
    expect(Math.abs(h.rig.CH.gazeX.t)).toBeLessThan(0.2);
  });

  it("a pointer moved while speaking or idle and then still for 2.6 s is not followed when listening starts", () => {
    for (const pose of ["speaking", "idle"] as const) {
      const on = build({ follow: true });
      const off = build();
      on.point(0.9, 0.3);
      off.point(0.9, 0.3);
      for (let t = 0; t < 2.6; t += 1 / 60) {
        on.frame(pose);
        off.frame(pose);
        expect(on.snapshot()).toEqual(off.snapshot());
      }
      for (let i = 0; i < 120; i++) {
        on.frame("listening");
        off.frame("listening");
        expect(on.rig.gaze.ptrLook).toBe(false);
        expect(on.snapshot()).toEqual(off.snapshot());
      }
    }
  });

  it("still mode ignores followPointer", () => {
    const on = build({ follow: true, still: true });
    const off = build({ still: true });
    on.point(0.9, 0.3);
    off.point(0.9, 0.3);
    on.frame("listening", 0);
    off.frame("listening", 0);
    expect(on.snapshot()).toEqual(off.snapshot());
  });
});

describe("updateGaze: followPointer changes nothing outside a live Listening follow (property)", () => {
  const arbPose = fc.constantFrom<Pose>("idle", "listening", "thinking", "speaking");
  const arbPointer = fc.tuple(fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: -3, max: 3, noNaN: true }));
  /** One frame; the pointer moves on about one frame in 21, so most listening frames see a pointer that is still. */
  const arbFrame = fc.record({
    kind: fc.constant("frame" as const),
    pose: arbPose,
    dt: fc.double({ min: 0, max: 0.05, noNaN: true }),
    pointer: fc.oneof({ weight: 20, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: arbPointer }),
  });
  /** About 60 frames of 0.05 s in a pose that is not listening, so more than 2.5 s can pass after a move. */
  const arbRest = fc.record({
    kind: fc.constant("rest" as const),
    pose: fc.constantFrom<Pose>("idle", "thinking", "speaking"),
    frames: fc.integer({ min: 50, max: 70 }),
  });
  const arbStep = fc.oneof({ weight: 8, arbitrary: arbFrame }, { weight: 1, arbitrary: arbRest });

  it("twin rigs, followPointer on and off, write identical targets except while listening to a pointer moved in the last 2.5 s", () => {
    let staleListening = 0;
    fc.assert(
      fc.property(fc.array(arbStep, { minLength: 1, maxLength: 120, size: "max" }), (steps) => {
        const on = build({ follow: true });
        const off = build();
        let moved = false;
        const both = (pose: Pose, dt: number) => {
          on.frame(pose, dt);
          off.frame(pose, dt);
          expect(on.snapshot()).toEqual(off.snapshot());
          if (pose === "listening" && moved) staleListening++;
        };
        for (const s of steps) {
          if (s.kind === "rest") {
            for (let i = 0; i < s.frames; i++) both(s.pose, 0.05);
            continue;
          }
          if (s.pointer) {
            on.point(s.pointer[0], s.pointer[1]);
            off.point(s.pointer[0], s.pointer[1]);
            moved = true;
          }
          const live = s.pose === "listening" && on.clock.T + s.dt - on.rig.gaze.lastPointer < 2.5;
          // Once a follow has run, the twins' timers and random streams part ways for good; stop comparing.
          if (live) return;
          both(s.pose, s.dt);
        }
      }),
      { numRuns: 150 },
    );
    // The generator reaches the case the property names: listening after a pointer that moved and went still.
    // Measured at about 130 to 170 such frames per 150 runs; the floor leaves room for an unlucky seed.
    expect(staleListening).toBeGreaterThan(20);
  });

  it("with followPointer and a live pointer, the listening head share always points the pointer's way", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.3, max: 3, noNaN: true }), fc.boolean(), (x, leftward) => {
        const h = build({ follow: true });
        h.point(leftward ? -x : x, 0);
        h.frame("listening");
        expect(h.rig.gaze.ptrLook).toBe(true);
        expect(Math.sign(h.rig.CH.lookYaw.t)).toBe(leftward ? -1 : 1);
        expect(Math.sign(h.rig.CH.gazeX.t)).toBe(leftward ? -1 : 1);
      }),
      { numRuns: 100 },
    );
  });
});
