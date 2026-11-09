/**
 * The Voice_Client's `onStreams` callback (lab-ui-foundation R11.3, R11.5). Same rig as
 * voice-client.test.ts: fake WebRTC, the real Server_Library routes on the Memory_Store, and virtual
 * time. Test-only imports of server test helpers; no browser module imports the Server_Library.
 */
import { testId } from "@franki/core/testing";
import { type RouteSpec, closeRoute, openRoute, receiptRoute, runRoute, sdpRoute, stateRoute, toolRoute, turnRoute } from "@franki/server";
import { describe, expect, it } from "vitest";
import { ok } from "../../../../packages/server/src/openai/fake";
import { T0_MS, type TestRig, settle, testRig } from "../../../../packages/server/src/testing/fakes";
import { type FetchLike, createApiClient } from "./api";
import { createBrowserClock } from "./clock";
import { type AudioLike, type ChannelLike, type PeerLike, type StreamLike, type TimerApi, type TrackLike, VoiceClient } from "./voice-client";

const ROUTES: Record<string, RouteSpec<unknown>> = {
  "/api/session/open": openRoute as RouteSpec<unknown>,
  "/api/session/sdp": sdpRoute as RouteSpec<unknown>,
  "/api/session/state": stateRoute as RouteSpec<unknown>,
  "/api/session/close": closeRoute as RouteSpec<unknown>,
  "/api/turn": turnRoute as RouteSpec<unknown>,
  "/api/tool": toolRoute as RouteSpec<unknown>,
  "/api/receipt": receiptRoute as RouteSpec<unknown>,
};

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 2_000 && !cond(); i++) await new Promise<void>((r) => setImmediate(r));
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
}

function serverFetch(rig: TestRig): FetchLike {
  return async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input, "http://localhost:3000");
    const body = typeof init.body === "string" ? init.body : "";
    const spec = ROUTES[url.pathname]!;
    const headers = new Map(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    headers.set("origin", "http://localhost:3000");
    const { value } = await settle(
      runRoute(spec, { method: init.method ?? "GET", url: url.href, header: (n) => headers.get(n.toLowerCase()) ?? null, text: async () => body }, rig.deps, rig.sched.schedule),
      rig.clock,
      rig.timers,
    );
    return Response.json(value.body, { status: value.status });
  };
}

class FakeTrack implements TrackLike {
  enabled = true;
  stop() {}
}
class FakeChannel implements ChannelLike {
  readyState = "connecting";
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send() {}
  close() {
    this.readyState = "closed";
  }
  open() {
    this.readyState = "open";
    this.onopen?.({});
  }
}
class FakePeer implements PeerLike {
  connectionState = "new";
  channel = new FakeChannel();
  remote: string | null = null;
  onconnectionstatechange: ((ev: unknown) => void) | null = null;
  ontrack: ((ev: { streams: readonly unknown[] }) => void) | null = null;
  addTrack() {}
  createDataChannel() {
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 offer" };
  }
  async setLocalDescription() {}
  async setRemoteDescription(d: { sdp: string }) {
    this.remote = d.sdp;
  }
  close() {}
}

const noTimers: TimerApi = { setTimeout: () => 0, clearTimeout: () => {} };

function setup(onStreams: (s: { mic: StreamLike | null; output: unknown | null }) => void) {
  const rig = testRig();
  rig.openai.script("realtime.calls.create", ok({ answerSdp: "v=0 answer", location: "/v1/realtime/calls/rtc_test1" }));
  rig.openai.always("realtime.calls.hangup", ok(null));
  const api = createApiClient({ getToken: async () => "token:owner-1", fetch: serverFetch(rig) });
  const clock = createBrowserClock({ zone: "America/Chicago", monotonic: { timeOrigin: T0_MS, now: () => rig.clock.read().opsClock.now - T0_MS } });
  const mic: StreamLike = { getAudioTracks: () => [new FakeTrack()] };
  const peers: FakePeer[] = [];
  const audio: AudioLike = { muted: true, srcObject: null };
  let n = 0;
  const vc = new VoiceClient({
    api,
    clock,
    transcribeModel: "test-transcribe-model",
    audio,
    timers: noTimers,
    createPeer: () => {
      const p = new FakePeer();
      peers.push(p);
      return p;
    },
    getMicrophone: async () => mic,
    newId: () => testId(`s${++n}`),
    onStreams,
  });
  return { vc, mic, audio, peer: () => peers.at(-1) };
}

describe("Voice_Client onStreams", () => {
  it("reports the mic after connect, the remote stream on ontrack, and both null on teardown", async () => {
    const reports: { mic: StreamLike | null; output: unknown | null }[] = [];
    const { vc, mic, audio, peer } = setup((s) => reports.push(s));
    vc.call();
    await until(() => peer()?.remote === "v=0 answer", "the SDP answer");
    expect(reports[0]).toEqual({ mic, output: null });

    const remote = { id: "remote" };
    peer()!.ontrack!({ streams: [remote] });
    expect(audio.srcObject).toBe(remote);
    expect(reports.at(-1)).toEqual({ mic, output: remote });

    vc.hangUp();
    await until(() => reports.at(-1)?.mic === null, "teardown report");
    expect(reports.at(-1)).toEqual({ mic: null, output: null });
    expect(audio.srcObject).toBeNull();
  });

  it("a throwing callback leaves call state unchanged", async () => {
    let calls = 0;
    const quiet = setup(() => {});
    const loud = setup(() => {
      calls++;
      throw new Error("meter broke");
    });
    for (const s of [quiet, loud]) {
      s.vc.call();
      await until(() => s.peer()?.remote === "v=0 answer", "the SDP answer");
      s.peer()!.ontrack!({ streams: [{ id: "remote" }] });
      s.peer()!.channel.open();
    }
    await until(() => loud.vc.getSnapshot().phase === quiet.vc.getSnapshot().phase, "same phase");
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(loud.vc.getSnapshot().phase).toBe(quiet.vc.getSnapshot().phase);
    expect(loud.vc.getSnapshot().error).toBe(quiet.vc.getSnapshot().error);
    expect(loud.audio.srcObject).toEqual({ id: "remote" });
  });
});
