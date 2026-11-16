import { describe, expect, it } from "vitest";
import { XRAY_LOAD_LIMIT_MS } from "../ui/xray/xray-machine";
import { XRAY_OFF_VIEW } from "../ui/xray/types";
import { FakeVideo, act, flush, xrayHarness } from "./testing/xray-fakes";
import { XRAY_DETECT_FAILURE_LIMIT, XRAY_SEEN_MEMORY_MS } from "./xray-watch";

/** On, with the camera open and the tracker loaded: searching. */
async function running() {
  const h = xrayHarness();
  await act(h, { act: "press" });
  const stream = await act(h, { act: "answer", index: 0, answer: "ok", cameras: 2 });
  h.tracker.settle(0, true);
  await flush();
  return { h, stream: stream! };
}

describe("xray store", () => {
  it("starts off with the off view, and the same snapshot until something changes", () => {
    const h = xrayHarness();
    expect(h.watch.getSnapshot()).toBe(XRAY_OFF_VIEW);
    h.watch.controls.close();
    h.watch.controls.flip();
    expect(h.watch.getSnapshot()).toBe(XRAY_OFF_VIEW);
    expect(h.camera.pending).toHaveLength(0);
  });

  it("asks for the camera only on a press, and plays it in the attached element", async () => {
    const h = xrayHarness();
    await act(h, { act: "press" });
    expect(h.watch.getSnapshot().signal).toBe("asking");
    expect(h.camera.pending.map((p) => p.facing)).toEqual(["user"]);
    const s = await act(h, { act: "answer", index: 0, answer: "ok", cameras: 1 });
    expect(h.watch.getSnapshot()).toMatchObject({ signal: "warming", cameraOn: true, canFlip: false });
    expect(h.video.srcObject).toBe(s!.asStream());
    expect(h.video.plays).toBe(1);
    expect(h.tracker.loads).toHaveLength(1);
  });

  it("shows the camera in an element attached later, and empties an element taken back", async () => {
    const { h, stream } = await running();
    const other = new FakeVideo();
    const detach = h.watch.feed.attach(other.asVideo());
    expect(other.srcObject).toBe(stream.asStream());
    expect(h.video.srcObject).toBeNull();
    detach();
    expect(other.srcObject).toBeNull();
    expect(stream.live).toBe(true);
  });

  it("runs the tracker once for each new picture, and finds", async () => {
    const { h } = await running();
    expect(h.watch.getSnapshot().signal).toBe("searching");
    expect(h.timers.pictureWatchers).toHaveLength(1);
    await act(h, { act: "picture", what: "face", ms: 33 });
    expect(h.tracker.detections).toBe(1);
    expect(h.watch.getSnapshot().signal).toBe("seeing");
    expect(h.watch.feed.latest()?.face).not.toBeNull();
  });

  it(`keeps seeing for ${XRAY_SEEN_MEMORY_MS} ms after the last face (ruling 13)`, async () => {
    const { h } = await running();
    await act(h, { act: "picture", what: "face", ms: 33 });
    await act(h, { act: "picture", what: "nothing", ms: XRAY_SEEN_MEMORY_MS - 1 });
    expect(h.watch.getSnapshot().signal).toBe("seeing");
    await act(h, { act: "picture", what: "nothing", ms: 1 });
    expect(h.watch.getSnapshot().signal).toBe("searching");
  });

  it(`counts ${XRAY_DETECT_FAILURE_LIMIT} thrown detections in a row as a failed tracker: film only`, async () => {
    const { h, stream } = await running();
    await act(h, { act: "picture", what: "throw", ms: 33 });
    await act(h, { act: "picture", what: "nothing", ms: 33 });
    await act(h, { act: "picture", what: "throw", ms: 33 });
    await act(h, { act: "picture", what: "throw", ms: 33 });
    expect(h.watch.getSnapshot().signal).toBe("searching");
    await act(h, { act: "picture", what: "throw", ms: 33 });
    expect(h.watch.getSnapshot().signal).toBe("filmOnly");
    expect(h.tracker.closes).toBeGreaterThan(0);
    expect(stream.live).toBe(true);
    expect(h.timers.pictureWatchers).toHaveLength(0);
  });

  it("leaves the film alone when the tracker has not loaded in time (ruling 12)", async () => {
    const h = xrayHarness();
    await act(h, { act: "press" });
    await act(h, { act: "answer", index: 0, answer: "ok", cameras: 1 });
    expect(h.timers.timers.map((t) => t.at)).toEqual([XRAY_LOAD_LIMIT_MS]);
    h.timers.fire();
    expect(h.watch.getSnapshot().signal).toBe("filmOnly");
    // The load that finishes later changes nothing.
    h.tracker.settle(0, true);
    await flush();
    expect(h.watch.getSnapshot().signal).toBe("filmOnly");
  });

  it("a tracker that fails to load leaves the film, and Try again starts over", async () => {
    const h = xrayHarness();
    await act(h, { act: "press" });
    const first = await act(h, { act: "answer", index: 0, answer: "ok", cameras: 1 });
    h.tracker.settle(0, false);
    await flush();
    expect(h.watch.getSnapshot().signal).toBe("filmOnly");
    expect(h.timers.timers).toEqual([]);
    await act(h, { act: "retry" });
    expect(first!.live).toBe(false);
    expect(h.watch.getSnapshot().signal).toBe("asking");
  });

  it("a refused camera is blocked, and nothing else is asked for", async () => {
    const h = xrayHarness();
    await act(h, { act: "press" });
    await act(h, { act: "answer", index: 0, answer: "blocked", cameras: 1 });
    expect(h.watch.getSnapshot().signal).toBe("blocked");
    expect(h.tracker.loads).toHaveLength(0);
  });

  it("a camera port that throws at once is noCamera", async () => {
    const h = xrayHarness();
    h.camera.open = () => {
      throw new Error("no mediaDevices");
    };
    await act(h, { act: "press" });
    expect(h.watch.getSnapshot().signal).toBe("noCamera");
  });

  it("a hidden tab stops the camera in the same step, and coming back does not restart it (ruling 11)", async () => {
    const { h, stream } = await running();
    h.visibility.set(true);
    expect(stream.live).toBe(false);
    expect(h.watch.getSnapshot()).toMatchObject({ power: "on", signal: "paused", cameraOn: false });
    expect(h.video.srcObject).toBeNull();
    h.visibility.set(false);
    await flush();
    expect(h.watch.getSnapshot().signal).toBe("paused");
    expect(h.camera.pending).toHaveLength(0);
  });

  it("a camera handed over after the press that turned it off is stopped at once", async () => {
    const h = xrayHarness();
    await act(h, { act: "press" });
    await act(h, { act: "press" });
    const late = await act(h, { act: "answer", index: 0, answer: "ok", cameras: 1 });
    expect(late!.live).toBe(false);
    expect(h.camera.log).toEqual(["publish asking", "publish dark", "arrive 1", "stop 1"]);
  });

  it("flip stops the open camera before asking for the other one", async () => {
    const { h, stream } = await running();
    await act(h, { act: "flip" });
    expect(stream.live).toBe(false);
    expect(h.camera.pending.map((p) => p.facing)).toEqual(["environment"]);
    expect(h.watch.getSnapshot()).toMatchObject({ signal: "asking", facing: "environment" });
  });

  it("a camera that stops on its own is noCamera", async () => {
    const { h, stream } = await running();
    await act(h, { act: "end" });
    expect(stream.live).toBe(false);
    expect(h.watch.getSnapshot()).toMatchObject({ signal: "noCamera", cameraOn: false });
    expect(h.watch.feed.latest()).toBeNull();
  });

  it("close stops the camera and closes the tracker (ruling 14)", async () => {
    const { h, stream } = await running();
    const closes = h.tracker.closes;
    h.watch.controls.close();
    expect(stream.live).toBe(false);
    expect(h.tracker.closes).toBe(closes + 1);
    expect(h.watch.getSnapshot()).toBe(XRAY_OFF_VIEW);
  });

  it("dispose stops everything and publishes nothing more", async () => {
    const { h, stream } = await running();
    let calls = 0;
    h.watch.subscribe(() => calls++);
    h.watch.dispose();
    // The dispose itself turns the machine off; after that, nothing.
    expect(calls).toBe(1);
    calls = 0;
    expect(stream.live).toBe(false);
    expect(h.visibility.listeners.size).toBe(0);
    h.watch.controls.press();
    await flush();
    expect(h.camera.pending).toHaveLength(0);
    expect(calls).toBe(0);
  });
});
