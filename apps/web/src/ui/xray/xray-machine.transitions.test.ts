import { describe, expect, it } from "vitest";
import { XRAY_OFF_VIEW } from "./types";
import { INITIAL_XRAY, type XrayCommand, type XrayEvent, type XrayState, xrayDetecting, xrayStep, xrayView } from "./xray-machine";

const at = (signal: XrayState["signal"], extra: Partial<XrayState> = {}): XrayState => ({
  ...INITIAL_XRAY,
  power: "on",
  signal,
  cameraOpen: signal === "warming" || signal === "searching" || signal === "seeing" || signal === "filmOnly",
  cameras: 2,
  session: 5,
  ...extra,
});
const kinds = (cs: readonly XrayCommand[]) => cs.map((c) => c.kind);
const cam = (report: "blocked" | "noCamera" | "ended", session = 5): XrayEvent => ({ kind: "camera", session, report });
const opened = (cameras: number, session = 5): XrayEvent => ({ kind: "camera", session, report: "opened", cameras });
const tr = (report: "ready" | "failed" | "timedOut" | "found" | "lost", session = 5): XrayEvent => ({ kind: "tracker", session, report });

describe("ui.xray transitions", () => {
  it("dark + press -> asking (on, the selfie camera asked for, a new session)", () => {
    const { state, commands } = xrayStep(INITIAL_XRAY, { kind: "press" });
    expect(state).toMatchObject({ power: "on", signal: "asking", facing: "user", cameraOpen: false, session: 1 });
    expect(commands).toEqual([{ kind: "openCamera", session: 1, facing: "user" }]);
  });

  it("asking + opened -> warming (the tracker loads, the load limit is armed)", () => {
    const { state, commands } = xrayStep(at("asking"), opened(3));
    expect(state).toMatchObject({ signal: "warming", cameraOpen: true, cameras: 3, session: 5 });
    expect(commands).toEqual([
      { kind: "loadTracker", session: 5 },
      { kind: "armLoadLimit", session: 5 },
    ]);
  });

  it("asking + opened -> warming (a count that is not a number counts as one camera)", () => {
    expect(xrayStep(at("asking"), opened(Number.NaN)).state.cameras).toBe(1);
    expect(xrayStep(at("asking"), opened(0)).state.cameras).toBe(1);
  });

  it("asking + blocked -> blocked (the owner or the browser refused)", () => {
    const { state, commands } = xrayStep(at("asking"), cam("blocked"));
    expect(state).toMatchObject({ signal: "blocked", cameraOpen: false, session: 6 });
    expect(commands).toEqual([]);
  });

  it("asking + noCamera -> noCamera (no camera, or the page may not use one)", () => {
    expect(xrayStep(at("asking"), cam("noCamera")).state.signal).toBe("noCamera");
  });

  it("warming + ready -> searching (the load limit is cleared)", () => {
    const { state, commands } = xrayStep(at("warming"), tr("ready"));
    expect(state.signal).toBe("searching");
    expect(commands).toEqual([{ kind: "clearLoadLimit" }]);
  });

  it("warming + failed -> filmOnly (the picture stays, the tracker closes)", () => {
    const { state, commands } = xrayStep(at("warming"), tr("failed"));
    expect(state).toMatchObject({ signal: "filmOnly", cameraOpen: true });
    expect(kinds(commands)).toEqual(["clearLoadLimit", "closeTracker"]);
  });

  it("warming + timedOut -> filmOnly (ruling 12: the files did not arrive in time)", () => {
    expect(xrayStep(at("warming"), tr("timedOut")).state.signal).toBe("filmOnly");
  });

  it("searching + timedOut -> searching (a late limit after the tracker loaded changes nothing)", () => {
    const s = at("searching");
    expect(xrayStep(s, tr("timedOut")).state).toBe(s);
  });

  it("searching + found -> seeing, seeing + lost -> searching", () => {
    expect(xrayStep(at("searching"), tr("found")).state.signal).toBe("seeing");
    expect(xrayStep(at("seeing"), tr("lost")).state.signal).toBe("searching");
  });

  it("seeing + failed -> filmOnly (three thrown detections in a row)", () => {
    const { state, commands } = xrayStep(at("seeing"), tr("failed"));
    expect(state).toMatchObject({ signal: "filmOnly", cameraOpen: true });
    expect(kinds(commands)).toEqual(["closeTracker"]);
  });

  it("seeing + press -> dark (off: the camera stops, the tracker closes)", () => {
    const { state, commands } = xrayStep(at("seeing"), { kind: "press" });
    expect(state).toEqual({ ...INITIAL_XRAY, session: 6 });
    expect(kinds(commands)).toEqual(["closeTracker", "stopCamera"]);
    expect(xrayView(state)).toBe(XRAY_OFF_VIEW);
  });

  it("warming + close -> dark (the load limit, the tracker and the camera all stop)", () => {
    expect(kinds(xrayStep(at("warming"), { kind: "close" }).commands)).toEqual(["clearLoadLimit", "closeTracker", "stopCamera"]);
  });

  it("asking + close -> dark (the request still out becomes stale)", () => {
    const off = xrayStep(at("asking"), { kind: "close" });
    expect(off.state).toMatchObject({ power: "off", signal: "dark", session: 6 });
    expect(off.commands).toEqual([]);
    expect(xrayStep(off.state, opened(1, 5))).toEqual({ state: off.state, commands: [{ kind: "dropStream", session: 5 }] });
  });

  it("dark + close -> dark (nothing to close)", () => {
    expect(xrayStep(INITIAL_XRAY, { kind: "close" }).state).toBe(INITIAL_XRAY);
  });

  it("seeing + flip -> asking (the open camera is told to stop before the other is asked for)", () => {
    const { state, commands } = xrayStep(at("seeing"), { kind: "flip" });
    expect(state).toMatchObject({ signal: "asking", facing: "environment", cameraOpen: false, session: 6 });
    expect(commands).toEqual([{ kind: "closeTracker" }, { kind: "stopCamera" }, { kind: "openCamera", session: 6, facing: "environment" }]);
  });

  it("filmOnly + flip -> asking (environment back to user)", () => {
    expect(xrayStep(at("filmOnly", { facing: "environment" }), { kind: "flip" }).state.facing).toBe("user");
  });

  it("seeing + flip -> seeing (one camera: nothing to flip to)", () => {
    const s = at("seeing", { cameras: 1 });
    expect(xrayStep(s, { kind: "flip" }).state).toBe(s);
  });

  it("asking + flip -> asking (no camera open yet: flip waits)", () => {
    const s = at("asking");
    expect(xrayStep(s, { kind: "flip" }).state).toBe(s);
  });

  it("blocked + retry -> asking (the same camera asked for again)", () => {
    const { state, commands } = xrayStep(at("blocked", { facing: "environment" }), { kind: "retry" });
    expect(state).toMatchObject({ signal: "asking", session: 6 });
    expect(commands).toEqual([{ kind: "openCamera", session: 6, facing: "environment" }]);
  });

  it("filmOnly + retry -> asking (the camera restarts and the tracker loads again)", () => {
    expect(xrayStep(at("filmOnly"), { kind: "retry" }).commands).toEqual([{ kind: "stopCamera" }, { kind: "openCamera", session: 6, facing: "user" }]);
  });

  it("seeing + retry -> seeing (nothing to retry)", () => {
    const s = at("seeing");
    expect(xrayStep(s, { kind: "retry" }).state).toBe(s);
  });

  it("seeing + hidden -> paused (ruling 11: the camera stops in the same step)", () => {
    const { state, commands } = xrayStep(at("seeing"), { kind: "hidden" });
    expect(state).toMatchObject({ power: "on", signal: "paused", cameraOpen: false, session: 6 });
    expect(kinds(commands)).toEqual(["closeTracker", "stopCamera"]);
  });

  it("asking + hidden -> paused (a camera handed over later is stopped at once)", () => {
    const { state } = xrayStep(at("asking"), { kind: "hidden" });
    expect(state.signal).toBe("paused");
    expect(xrayStep(state, opened(2, 5)).commands).toEqual([{ kind: "dropStream", session: 5 }]);
  });

  it("blocked + hidden -> blocked (no camera to pause)", () => {
    const s = at("blocked");
    expect(xrayStep(s, { kind: "hidden" }).state).toBe(s);
  });

  it("paused + shown -> paused (coming back does not restart the camera)", () => {
    const s = at("paused");
    expect(xrayStep(s, { kind: "shown" }).state).toBe(s);
  });

  it("paused + retry -> asking (Start again)", () => {
    expect(xrayStep(at("paused"), { kind: "retry" }).state.signal).toBe("asking");
  });

  it("seeing + ended -> noCamera (the camera stopped on its own)", () => {
    const { state, commands } = xrayStep(at("seeing"), cam("ended"));
    expect(state).toMatchObject({ signal: "noCamera", cameraOpen: false, session: 6 });
    expect(kinds(commands)).toEqual(["closeTracker", "stopCamera"]);
  });

  it("seeing + opened -> seeing (a second camera for the same session is handed back)", () => {
    const s = at("seeing");
    expect(xrayStep(s, opened(2))).toEqual({ state: s, commands: [{ kind: "dropStream", session: 5 }] });
  });

  it("warming + an older session's report -> warming (stale)", () => {
    const s = at("warming");
    expect(xrayStep(s, tr("ready", 4)).state).toBe(s);
    expect(xrayStep(s, cam("ended", 4)).state).toBe(s);
  });

  it("runs the tracker only while searching or seeing with a camera open", () => {
    expect(xrayDetecting(at("searching"))).toBe(true);
    expect(xrayDetecting(at("seeing"))).toBe(true);
    expect(xrayDetecting(at("warming"))).toBe(false);
    expect(xrayDetecting(at("filmOnly"))).toBe(false);
    expect(xrayDetecting(INITIAL_XRAY)).toBe(false);
  });

  it("views: canFlip only with a camera open and two of them", () => {
    expect(xrayView(at("seeing"))).toEqual({ power: "on", signal: "seeing", facing: "user", canFlip: true, cameraOn: true });
    expect(xrayView(at("asking")).canFlip).toBe(false);
    expect(xrayView(at("seeing", { cameras: 1 })).canFlip).toBe(false);
  });
});
