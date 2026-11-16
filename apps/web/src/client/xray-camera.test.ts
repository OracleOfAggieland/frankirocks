import { describe, expect, it } from "vitest";
import { FakeStream, FakeTrack } from "./testing/xray-fakes";
import { XrayCameraError, type XrayMediaDevices, createBrowserCamera, onTrackEnded, xrayCameraFailure, xrayConstraints } from "./xray-camera";

const named = (name: string) => Object.assign(new Error(name), { name });

function media(answer: () => Promise<MediaStream>, devices: { kind: string }[] = [{ kind: "videoinput" }]) {
  const asked: MediaStreamConstraints[] = [];
  const m: XrayMediaDevices = {
    getUserMedia: (c) => {
      asked.push(c);
      return answer();
    },
    enumerateDevices: () => Promise.resolve(devices),
  };
  return { m, asked };
}

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "resolved";
  } catch (err) {
    return err instanceof XrayCameraError ? err.reason : "other";
  }
}

describe("xray camera", () => {
  it("asks for video only, the facing and 1280 by 720 as ideals", () => {
    expect(xrayConstraints("environment")).toEqual({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  });

  it("NotAllowedError and SecurityError are blocked; everything else is noCamera", () => {
    expect(xrayCameraFailure(named("NotAllowedError"))).toBe("blocked");
    expect(xrayCameraFailure(named("SecurityError"))).toBe("blocked");
    for (const n of ["NotFoundError", "NotReadableError", "OverconstrainedError", "AbortError", "TypeError"]) expect(xrayCameraFailure(named(n))).toBe("noCamera");
    expect(xrayCameraFailure("nope")).toBe("noCamera");
    expect(xrayCameraFailure(null)).toBe("noCamera");
  });

  it("opens with the request above and counts the cameras after it is allowed", async () => {
    const stream = new FakeStream(1);
    const { m, asked } = media(() => Promise.resolve(stream.asStream()), [{ kind: "videoinput" }, { kind: "audioinput" }, { kind: "videoinput" }]);
    const opened = await createBrowserCamera(m).open("user");
    expect(asked).toEqual([xrayConstraints("user")]);
    expect(opened).toEqual({ stream: stream.asStream(), cameras: 2 });
  });

  it("counts one camera when the devices cannot be listed", async () => {
    const stream = new FakeStream(1);
    const m: XrayMediaDevices = { getUserMedia: () => Promise.resolve(stream.asStream()), enumerateDevices: () => Promise.reject(new Error("no")) };
    expect((await createBrowserCamera(m).open("user")).cameras).toBe(1);
    expect((await createBrowserCamera({ getUserMedia: () => Promise.resolve(stream.asStream()) }).open("user")).cameras).toBe(1);
  });

  it("rejects with blocked or noCamera, and noCamera on a page with no mediaDevices", async () => {
    expect(await reason(createBrowserCamera(media(() => Promise.reject(named("NotAllowedError"))).m).open("user"))).toBe("blocked");
    expect(await reason(createBrowserCamera(media(() => Promise.reject(named("NotFoundError"))).m).open("user"))).toBe("noCamera");
    expect(await reason(createBrowserCamera(undefined).open("user"))).toBe("noCamera");
  });

  it("a stream with no video track is stopped and is noCamera", async () => {
    const audioOnly = new FakeStream(1, [new FakeTrack("audio")]);
    expect(await reason(createBrowserCamera(media(() => Promise.resolve(audioOnly.asStream())).m).open("user"))).toBe("noCamera");
    expect(audioOnly.live).toBe(false);
  });

  it("stop stops every track, twice safely", () => {
    const s = new FakeStream(1, [new FakeTrack(), new FakeTrack("audio")]);
    const camera = createBrowserCamera(undefined);
    camera.stop(s.asStream());
    camera.stop(s.asStream());
    expect(s.tracks.every((t) => t.stopped)).toBe(true);
  });

  it("reports a track that ends on its own once, and not after the listener is taken back", () => {
    const s = new FakeStream(1);
    let ended = 0;
    const off = onTrackEnded(s.asStream(), () => ended++);
    s.tracks[0]!.end();
    s.tracks[0]!.end();
    expect(ended).toBe(1);
    const s2 = new FakeStream(2);
    const off2 = onTrackEnded(s2.asStream(), () => ended++);
    off2();
    s2.tracks[0]!.end();
    expect(ended).toBe(1);
    off();
  });
});
