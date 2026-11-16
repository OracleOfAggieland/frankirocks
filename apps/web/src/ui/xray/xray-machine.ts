/**
 * @machine ui.xray
 *
 * The X-ray machine on the stage and its screen, as a pure machine (brief 051). On means the screen is open; off
 * means it is closed and no camera is open (ruling 4). The camera, the tracker and the timers are outside it: each
 * step returns what the store must do next, as commands, so the store holds no rules of its own.
 *
 * Always: off is `dark` with no camera open; `warming`, `searching` and `seeing` hold only while a camera is open;
 * a hidden tab leaves no camera open; no step asks for a camera while one is open (the open one is told to stop
 * first). Every camera life has its own `session`: a press that asks for a camera, a flip, a retry, and every stop of
 * a camera or of a request (off, hidden, a camera that ended) raise it, and a camera or tracker report naming any
 * other session changes nothing; a camera handed over for an older session comes back as `dropStream`, to be
 * stopped at once. Never: a clock read, a random source, the DOM, a write, or a throw.
 */
import { XRAY_OFF_VIEW, type XrayFacing, type XrayPower, type XraySignal, type XrayView } from "./types";

export interface XrayState {
  readonly power: XrayPower;
  readonly signal: XraySignal;
  readonly facing: XrayFacing;
  /** How many cameras the device reported when the last camera opened; 0 before the first. */
  readonly cameras: number;
  /** True while the store holds a camera stream for `session`. */
  readonly cameraOpen: boolean;
  /** Raised on every new camera life and every stop. A report naming another session is stale. */
  readonly session: number;
}

export const INITIAL_XRAY: XrayState = Object.freeze({
  power: "off",
  signal: "dark",
  facing: "user",
  cameras: 0,
  cameraOpen: false,
  session: 0,
});

/** Ruling 12: a tracker whose files have not arrived this long after the picture showed leaves the film alone. */
export const XRAY_LOAD_LIMIT_MS = 20_000;

/** Ruling 10: the camera asked for first, on every turn on. */
export const XRAY_FIRST_FACING: XrayFacing = "user";

/** What the camera reports for a session. `ended` is a track that stopped on its own. */
export type XrayCameraReport = "opened" | "blocked" | "noCamera" | "ended";
/** What the tracker reports for a session. `timedOut` comes from the load limit's timer. */
export type XrayTrackerReport = "ready" | "failed" | "timedOut" | "found" | "lost";

export type XrayEvent =
  /** The machine on the stage. Off: on, and the camera is asked for. On: off. */
  | { kind: "press" }
  /** The screen's close button, Escape or the scrim: off. */
  | { kind: "close" }
  /** The other camera, while one is open and the device has two or more. */
  | { kind: "flip" }
  /** "Try again" or "Start again": from blocked, noCamera, paused or filmOnly, the camera is asked for again. */
  | { kind: "retry" }
  | { kind: "camera"; session: number; report: "opened"; cameras: number }
  | { kind: "camera"; session: number; report: Exclude<XrayCameraReport, "opened"> }
  | { kind: "tracker"; session: number; report: XrayTrackerReport }
  /** The tab was hidden (ruling 11). */
  | { kind: "hidden" }
  /** The tab came back. It changes nothing: "Start again" restarts the camera (ruling 11). */
  | { kind: "shown" };

export type XrayCommand =
  /** Ask the browser for a camera facing this way; its answer names `session`. Run inside the press. */
  | { kind: "openCamera"; session: number; facing: XrayFacing }
  /** Stop every track of the camera the store holds, and empty the picture. */
  | { kind: "stopCamera" }
  /** A camera handed over for an old session: stop its tracks now, before anything else. */
  | { kind: "dropStream"; session: number }
  /** Load the tracker; its answer names `session`. */
  | { kind: "loadTracker"; session: number }
  /** Close the tracker, or stop a load that is still going. */
  | { kind: "closeTracker" }
  /** After XRAY_LOAD_LIMIT_MS, send the tracker's `timedOut` for this session. */
  | { kind: "armLoadLimit"; session: number }
  | { kind: "clearLoadLimit" };

export interface XrayStepResult {
  readonly state: XrayState;
  readonly commands: readonly XrayCommand[];
}

const NOTHING: readonly XrayCommand[] = Object.freeze([]);
const same = (s: XrayState): XrayStepResult => ({ state: s, commands: NOTHING });

/** True while the tracker is loading or running for the open camera. */
const trackerLive = (s: XrayState) => s.signal === "warming" || s.signal === "searching" || s.signal === "seeing";

/** True while the store should run the tracker on each new picture. */
export function xrayDetecting(s: XrayState): boolean {
  return s.power === "on" && s.cameraOpen && (s.signal === "searching" || s.signal === "seeing");
}

/** The commands that end the current camera life: the camera stops and the tracker closes. Raises nothing. */
function endLife(s: XrayState): XrayCommand[] {
  const out: XrayCommand[] = [];
  if (s.signal === "warming") out.push({ kind: "clearLoadLimit" });
  if (trackerLive(s)) out.push({ kind: "closeTracker" });
  if (s.cameraOpen) out.push({ kind: "stopCamera" });
  return out;
}

function turnOff(s: XrayState): XrayStepResult {
  if (s.power === "off") return same(s);
  return { state: { ...INITIAL_XRAY, session: s.session + 1 }, commands: endLife(s) };
}

/** A new camera life facing `facing`: the old one ends first, then the camera is asked for. */
function ask(s: XrayState, facing: XrayFacing): XrayStepResult {
  const session = s.session + 1;
  return {
    state: { ...s, power: "on", signal: "asking", facing, cameraOpen: false, session },
    commands: [...endLife(s), { kind: "openCamera", session, facing }],
  };
}

const cameraCount = (n: number) => (Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1);

function onCamera(s: XrayState, e: Extract<XrayEvent, { kind: "camera" }>): XrayStepResult {
  switch (e.report) {
    case "opened":
      // Only the request this session asked for is taken; anything else is handed back to be stopped.
      if (s.power !== "on" || s.signal !== "asking" || s.cameraOpen) return { state: s, commands: [{ kind: "dropStream", session: e.session }] };
      return {
        state: { ...s, signal: "warming", cameraOpen: true, cameras: cameraCount(e.cameras) },
        commands: [
          { kind: "loadTracker", session: s.session },
          { kind: "armLoadLimit", session: s.session },
        ],
      };
    case "blocked":
    case "noCamera":
      if (s.signal !== "asking") return same(s);
      return { state: { ...s, signal: e.report, session: s.session + 1 }, commands: NOTHING };
    case "ended":
      if (!s.cameraOpen) return same(s);
      return { state: { ...s, signal: "noCamera", cameraOpen: false, session: s.session + 1 }, commands: endLife(s) };
    default:
      e satisfies never;
      return same(s);
  }
}

function onTracker(s: XrayState, report: XrayTrackerReport): XrayStepResult {
  switch (report) {
    case "ready":
      if (s.signal !== "warming") return same(s);
      return { state: { ...s, signal: "searching" }, commands: [{ kind: "clearLoadLimit" }] };
    case "failed":
    case "timedOut":
      if (!trackerLive(s) || (report === "timedOut" && s.signal !== "warming")) return same(s);
      return { state: { ...s, signal: "filmOnly" }, commands: endLife(s).filter((c) => c.kind !== "stopCamera") };
    case "found":
      return s.signal === "searching" ? { state: { ...s, signal: "seeing" }, commands: NOTHING } : same(s);
    case "lost":
      return s.signal === "seeing" ? { state: { ...s, signal: "searching" }, commands: NOTHING } : same(s);
    default:
      report satisfies never;
      return same(s);
  }
}

/** Total: every event is defined in every state. Returns `s` itself, with no commands, when nothing changes. */
export function xrayStep(s: XrayState, e: XrayEvent): XrayStepResult {
  const on = s.power === "on";
  switch (e.kind) {
    case "press":
      return on ? turnOff(s) : ask({ ...INITIAL_XRAY, session: s.session }, XRAY_FIRST_FACING);
    case "close":
      return turnOff(s);
    case "flip":
      if (!on || !s.cameraOpen || s.cameras < 2) return same(s);
      return ask(s, s.facing === "user" ? "environment" : "user");
    case "retry":
      if (!on || !(s.signal === "blocked" || s.signal === "noCamera" || s.signal === "paused" || s.signal === "filmOnly")) return same(s);
      return ask(s, s.facing);
    case "camera":
      if (e.session !== s.session) return e.report === "opened" ? { state: s, commands: [{ kind: "dropStream", session: e.session }] } : same(s);
      return onCamera(s, e);
    case "tracker":
      if (e.session !== s.session || !on) return same(s);
      return onTracker(s, e.report);
    case "hidden":
      if (!on || !(s.cameraOpen || s.signal === "asking")) return same(s);
      return { state: { ...s, signal: "paused", cameraOpen: false, session: s.session + 1 }, commands: endLife(s) };
    case "shown":
      return same(s);
    default:
      e satisfies never;
      return same(s);
  }
}

/** What the screen draws. Off is XRAY_OFF_VIEW itself. */
export function xrayView(s: XrayState): XrayView {
  if (s.power === "off") return XRAY_OFF_VIEW;
  return { power: s.power, signal: s.signal, facing: s.facing, canFlip: s.cameraOpen && s.cameras >= 2, cameraOn: s.cameraOpen };
}
