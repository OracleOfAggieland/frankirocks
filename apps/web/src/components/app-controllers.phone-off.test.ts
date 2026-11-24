// Brief 054 part D2: the controllers pass a demo visit to the Voice_Client as `phoneOff`, and nothing otherwise.
import { describe, expect, it } from "vitest";
import type { ApiClient, ApiResult } from "../client/api";
import { createBrowserClock } from "../client/clock";
import type { PeerLike, StreamLike } from "../client/voice-client";
import { type ControllerDeps, createSignedInControllers } from "./app-controllers";

function voiceOf(extra: Pick<ControllerDeps, "demo">) {
  const api: ApiClient = {
    async call<T>() {
      return { ok: false, kind: "http", status: 503, error: "DEPENDENCY", retryAfterMs: 0 } as ApiResult<T>;
    },
  };
  const c = createSignedInControllers({
    api,
    clock: createBrowserClock({ zone: "UTC", monotonic: { timeOrigin: 0, now: () => 0 } }),
    transcribeModel: "test-transcribe",
    debug: false,
    audio: () => ({ muted: true, srcObject: null }),
    createPeer: () => ({}) as PeerLike,
    getMicrophone: async () => ({ getAudioTracks: () => [] }) as StreamLike,
    onStreams: () => {},
    ...extra,
  });
  return c.voice!.getSnapshot();
}

describe("signed-in controllers: the phone on a demo visit (brief 054 part D2)", () => {
  it("demo: the call's machine has phoneOff", () => {
    expect(voiceOf({ demo: true }).phoneOff).toBe(true);
  });
  it("not demo (absent or false): the machine is as today, with no phoneOff", () => {
    expect(voiceOf({})).not.toHaveProperty("phoneOff");
    expect(voiceOf({ demo: false })).not.toHaveProperty("phoneOff");
  });
});
