// A tracker with no camera (brief 051 part C), for the specimens and the tests: a pure function from a time to an
// XrayFrame. A head turns, nods and talks, and two hands wave and close. It is built the way the real tracker's
// answer is: a head pose matrix that places MediaPipe's canonical head in front of the XRAY_CAMERA_FOV camera, and
// landmarks that are those same canonical points projected through that same camera, so the skull's screen
// correction comes out at about none. Only the landmarks the X-ray screen reads (the named key points and the face
// oval) are the canonical head's own; every other landmark is put at the head's middle. Hand joints come from a
// small hand drawn in centimetres, posed, and projected the same way.
import { CANONICAL, CANONICAL_OVAL, FACE_OVAL, FACE_POINT_COUNT, LANDMARK } from "../../../components/xray/anatomy/canonical";
import { XRAY_CAMERA_FOV, type XrayFace, type XrayFeed, type XrayFrame, type XrayHand, type XrayPoint } from "../types";

interface V3 {
  x: number;
  y: number;
  z: number;
}

/** The scripted picture's width over its height: a landscape webcam. */
export const SCRIPTED_ASPECT = 16 / 9;

const DEG = Math.PI / 180;
const wave = (t: number, periodMs: number, phase = 0) => Math.sin((2 * Math.PI * t) / periodMs + phase);

/** A turn as a 3 by 3 matrix, row by row: roll about z, after yaw about y, after pitch about x. */
function turn(yaw: number, pitch: number, roll: number): number[] {
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
  // Rz * Ry * Rx
  return [
    cr * cy, cr * sy * sp - sr * cp, cr * sy * cp + sr * sp,
    sr * cy, sr * sy * sp + cr * cp, sr * sy * cp - cr * sp,
    -sy, cy * sp, cy * cp,
  ];
}

const apply = (r: readonly number[], p: V3, t: V3): V3 => ({
  x: r[0]! * p.x + r[1]! * p.y + r[2]! * p.z + t.x,
  y: r[3]! * p.x + r[4]! * p.y + r[5]! * p.z + t.y,
  z: r[6]! * p.x + r[7]! * p.y + r[8]! * p.z + t.z,
});

const FOCAL = 1 / Math.tan((XRAY_CAMERA_FOV * DEG) / 2);

/** A camera-space point (cm, the camera looking down -z) on the picture, with depth in x's scale from `root`. */
function project(c: V3, root: V3, aspect: number): XrayPoint {
  const x = ((FOCAL / aspect) * (c.x / -c.z) + 1) / 2;
  const y = (1 - FOCAL * (c.y / -c.z)) / 2;
  // Picture widths per centimetre at the root's depth; nearer is smaller.
  const perCm = FOCAL / aspect / (2 * -root.z);
  return { x, y, z: -(c.z - root.z) * perCm };
}

/** The head's pose at `t` ms: turning, nodding, a little tilt, and where it sits in front of the camera. */
export function scriptedHeadPose(t: number): { yaw: number; pitch: number; roll: number; at: V3 } {
  return {
    yaw: 28 * DEG * wave(t, 6100),
    pitch: 12 * DEG * wave(t, 4300, 1.1),
    roll: 7 * DEG * wave(t, 7700, 0.4),
    at: { x: 1.5 * wave(t, 9100), y: 3 + 1 * wave(t, 5300), z: -46 },
  };
}

/** How far the jaw is open at `t` ms: bursts of talk with pauses between. */
export function scriptedJaw(t: number): number {
  const syllables = Math.max(0, wave(t, 310));
  const phrase = Math.max(0, wave(t, 2900, 0.6));
  return Math.min(1, syllables * phrase * 0.9);
}

function scriptedFace(t: number, aspect: number): XrayFace {
  const pose = scriptedHeadPose(t);
  const r = turn(pose.yaw, pose.pitch, pose.roll);
  const toCamera = (p: V3) => apply(r, p, pose.at);
  const root = pose.at;
  const middle = project(root, root, aspect);
  const points: XrayPoint[] = Array.from({ length: FACE_POINT_COUNT }, () => middle);
  for (const name of Object.keys(LANDMARK) as (keyof typeof LANDMARK)[]) points[LANDMARK[name]] = project(toCamera(CANONICAL[name]), root, aspect);
  FACE_OVAL.forEach((index, i) => {
    points[index] = project(toCamera(CANONICAL_OVAL[i]!), root, aspect);
  });
  // Column by column, the move in 12 to 14.
  const matrix = [r[0]!, r[3]!, r[6]!, 0, r[1]!, r[4]!, r[7]!, 0, r[2]!, r[5]!, r[8]!, 0, pose.at.x, pose.at.y, pose.at.z, 1];
  return { matrix, points, jaw: scriptedJaw(t) };
}

/** One finger's joints from its knuckle (cm, the hand flat in its own x-y plane, fingers up +y, palm toward +z). */
interface Finger {
  readonly base: V3;
  readonly lengths: readonly [number, number, number];
  /** How far each joint bends when the hand is closed, radians, in order from the knuckle. */
  readonly bend: readonly [number, number, number];
  /** The thumb bends across the palm, not into it. */
  readonly thumb?: boolean;
}

/** A right hand, thumb to +x. A left hand is the same mirrored. */
const FINGERS: readonly Finger[] = [
  { base: { x: 2.3, y: 2.6, z: 0.6 }, lengths: [4.2, 3.1, 2.5], bend: [0.5, 0.7, 0.9], thumb: true },
  { base: { x: 2.5, y: 9.0, z: 0 }, lengths: [4.0, 2.4, 1.9], bend: [1.25, 1.65, 1.2] },
  { base: { x: 0.75, y: 9.3, z: 0 }, lengths: [4.5, 2.8, 2.0], bend: [1.25, 1.65, 1.2] },
  { base: { x: -1.0, y: 8.8, z: 0 }, lengths: [4.2, 2.6, 1.9], bend: [1.25, 1.65, 1.2] },
  { base: { x: -2.6, y: 7.9, z: 0 }, lengths: [3.4, 2.0, 1.7], bend: [1.25, 1.65, 1.2] },
];

/** The 21 joints of a right hand at rest (closed 0) or in a fist (closed 1), cm, wrist at the origin. */
export function handJoints(closed: number): V3[] {
  const joints: V3[] = [{ x: 0, y: 0, z: 0 }];
  for (const f of FINGERS) {
    joints.push(f.base);
    let p = f.base;
    // The finger's direction, turning toward the palm's side (+z) one joint at a time.
    let angle = 0;
    const spreadOut = f.thumb ? 0.75 : Math.atan2(f.base.x, 9) * 0.35;
    for (let i = 0; i < 3; i++) {
      angle += f.bend[i]! * closed;
      const len = f.lengths[i]!;
      if (f.thumb) {
        // The thumb leans out, and closes across the palm toward -x.
        const across = spreadOut - angle;
        p = { x: p.x + len * Math.sin(across), y: p.y + len * Math.cos(across) * 0.85, z: p.z + len * 0.35 * Math.sin(angle) };
      } else {
        p = { x: p.x + len * Math.sin(spreadOut) * Math.cos(angle), y: p.y + len * Math.cos(angle), z: p.z + len * Math.sin(angle) };
      }
      joints.push(p);
    }
  }
  return joints;
}

function scriptedHand(t: number, aspect: number, side: "left" | "right"): XrayHand {
  const s = side === "right" ? 1 : -1;
  const phase = side === "right" ? 0 : 1.7;
  const closed = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 3400 + phase);
  // Palm to the camera, fingers up, waving side to side; the person's right hand is on the picture's left.
  const r = turn(14 * DEG * wave(t, 2100, phase) * s, -15 * DEG, 22 * DEG * wave(t, 1500, phase));
  const at: V3 = { x: -s * (19 + 2 * wave(t, 5000, phase)), y: -12 + 2 * wave(t, 2600, phase), z: -50 };
  const joints = handJoints(closed).map((j) => apply(r, { x: j.x * s, y: j.y, z: j.z }, at));
  return { points: joints.map((c) => project(c, at, aspect)), side };
}

/** The scripted tracker's answer at `t` ms. */
export function scriptedFrame(t: number, aspect = SCRIPTED_ASPECT): XrayFrame {
  return { at: t, aspect, face: scriptedFace(t, aspect), hands: [scriptedHand(t, aspect, "right"), scriptedHand(t, aspect, "left")] };
}

/**
 * A feed with no camera: `latest()` is the scripted frame at `now()`. It takes the element it is given and leaves it
 * empty, so the screen shows dark film under the bones.
 */
export function createScriptedFeed(now: () => number, aspect = SCRIPTED_ASPECT): XrayFeed {
  return {
    attach: () => () => {},
    latest: () => scriptedFrame(now(), aspect),
  };
}
