/**
 * The Voice_Client's microphone step at call start, pinned as it behaves today. `connect` asks for the mic after
 * the open answered, and the reducer's connect limit (`CONNECT_LIMIT_MS`, armed at `openOk`) runs while the
 * permission prompt is open. A rejected mic reaches the reducer as `sdpFailed`, which is connection recovery.
 *
 * Same rig as voice-client.test.ts: fake WebRTC, the real Server_Library routes on the Memory_Store with
 * Fake_OpenAI, and virtual time shared by the browser clock, the Voice_Client's timers and the server.
 * Test-only imports of server test helpers; no browser module imports the Server_Library.
 */
import { CONNECT_LIMIT_MS, RETRY_DELAYS_MS, RETRY_UI_MS } from "@franki/core";
import { testId } from "@franki/core/testing";
import { type RouteSpec, closeRoute, openRoute, receiptRoute, runRoute, sdpRoute, stateRoute, toolRoute, turnRoute } from "@franki/server";
import { describe, expect, it } from "vitest";
import { ok } from "../../../../packages/server/src/openai/fake";
import { paths } from "../../../../packages/server/src/store/paths";
import { T0_MS, type TestRig, settle, testRig } from "../../../../packages/server/src/testing/fakes";
import { type FetchLike, createApiClient } from "./api";
import { createBrowserClock } from "./clock";
import { type AudioLike, type ChannelLike, type PeerLike, type StreamLike, type TimerApi, type TrackLike, VoiceClient } from "./voice-client";

const UID = "owner-1";
const ROUTES: Record<string, RouteSpec<unknown>> = {
  "/api/session/open": openRoute as RouteSpec<unknown>,
  "/api/session/sdp": sdpRoute as RouteSpec<unknown>,
  "/api/session/state": stateRoute as RouteSpec<unknown>,
  "/api/session/close": closeRoute as RouteSpec<unknown>,
  "/api/turn": turnRoute as RouteSpec<unknown>,
  "/api/tool": toolRoute as RouteSpec<unknown>,
  "/api/receipt": receiptRoute as RouteSpec<unknown>,
};

const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r));
};

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 2_000 && !cond(); i++) await new Promise<void>((r) => setImmediate(r));
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
  await flush(5);
}

interface Call {
  path: string;
  body: { reason?: string } | null;
}

function serverFetch(rig: TestRig): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const f = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input, "http://localhost:3000");
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ path: url.pathname, body: body === "" ? null : (JSON.parse(body) as Call["body"]) });
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
  return Object.assign(f, { calls });
}

class FakeTrack implements TrackLike {
  enabled = true;
  stopped = false;
  stop() {
    this.stopped = true;
  }
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

/** Virtual-time timers on the rig's fake opsClock, shared by the browser clock. */
function virtualTimers(rig: TestRig): TimerApi & { advance(ms: number): Promise<void> } {
  let seq = 0;
  const queue = new Map<number, { due: number; fn: () => void }>();
  const now = () => rig.clock.read().opsClock.now;
  return {
    setTimeout(fn, ms) {
      const id = ++seq;
      queue.set(id, { due: now() + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(h) {
      queue.delete(h as number);
    },
    async advance(ms) {
      const target = now() + ms;
      for (;;) {
        const next = [...queue.entries()].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (next === undefined) break;
        queue.delete(next[0]);
        if (next[1].due > now()) rig.clock.advance(next[1].due - now());
        next[1].fn();
        await flush();
      }
      if (target > now()) rig.clock.advance(target - now());
      await flush();
    },
  };
}

/**
 * A microphone behind a permission prompt. Each request waits while the prompt is open; `allow` answers every
 * waiting request and every later one with a new stream; `deny` makes every request reject.
 */
function promptedMic() {
  const waiting: { resolve: (s: StreamLike) => void; reject: (e: unknown) => void }[] = [];
  const tracks: FakeTrack[] = [];
  let answer: "prompt" | "allowed" | "denied" = "prompt";
  let requests = 0;
  const stream = (): StreamLike => {
    const track = new FakeTrack();
    tracks.push(track);
    return { getAudioTracks: () => [track] };
  };
  const denied = () => new DOMException("Permission denied", "NotAllowedError");
  return {
    get requests() {
      return requests;
    },
    tracks,
    getMicrophone(): Promise<StreamLike> {
      requests++;
      if (answer === "allowed") return Promise.resolve(stream());
      if (answer === "denied") return Promise.reject(denied());
      return new Promise<StreamLike>((resolve, reject) => waiting.push({ resolve, reject }));
    },
    allow() {
      answer = "allowed";
      for (const w of waiting.splice(0)) w.resolve(stream());
    },
    deny() {
      answer = "denied";
      for (const w of waiting.splice(0)) w.reject(denied());
    },
  };
}

function setup() {
  const rig = testRig();
  rig.openai.always("realtime.calls.create", ok({ answerSdp: "v=0 answer", location: "/v1/realtime/calls/rtc_test1" }));
  rig.openai.always("realtime.calls.hangup", ok(null));
  const fetch = serverFetch(rig);
  const api = createApiClient({ getToken: async () => "token:owner-1", fetch });
  const clock = createBrowserClock({ zone: "America/Chicago", monotonic: { timeOrigin: T0_MS, now: () => rig.clock.read().opsClock.now - T0_MS } });
  const timers = virtualTimers(rig);
  const mic = promptedMic();
  const peers: FakePeer[] = [];
  const audio: AudioLike = { muted: true, srcObject: null };
  let n = 0;
  const vc = new VoiceClient({
    api,
    clock,
    transcribeModel: "test-transcribe-model",
    audio,
    timers,
    createPeer: () => {
      const p = new FakePeer();
      peers.push(p);
      return p;
    },
    getMicrophone: () => mic.getMicrophone(),
    newId: () => testId(`m${++n}`),
  });
  const phases: string[] = [];
  vc.subscribe(() => {
    const p = vc.getSnapshot().phase;
    if (phases.at(-1) !== p) phases.push(p);
  });
  const routeCalls = (path: string) => fetch.calls.filter((c) => c.path === path);
  const sessions = () => rig.store.countUnder(paths.collection(UID, "sessions"));
  return { rig, vc, mic, peers, timers, phases, routeCalls, sessions };
}

describe("Voice_Client microphone at call start (today)", () => {
  it("today: mic allowed at 8 s goes through RECOVERY, and the call connects on a second Session", async () => {
    const { vc, mic, peers, timers, phases, routeCalls, sessions } = setup();
    vc.call();
    await until(() => mic.requests === 1, "the first mic request");
    expect(vc.getSnapshot().phase).toBe("CONNECTING");

    // The prompt stays open for 8 s. The connect limit fires at CONNECT_LIMIT_MS while it is open.
    await timers.advance(8_000);
    expect(8_000).toBeGreaterThan(CONNECT_LIMIT_MS + RETRY_DELAYS_MS[0]);
    expect(phases).toContain("RECOVERY");
    expect(vc.getSnapshot().recovery).toMatchObject({ kind: "connection", attempts: 1 });
    // The reconnect opened a second Session, whose connect asked for the mic again.
    expect(routeCalls("/api/session/open")).toHaveLength(2);
    expect(routeCalls("/api/session/close").map((c) => c.body?.reason)).toEqual(["error"]);
    expect(mic.requests).toBe(2);

    mic.allow();
    await until(() => peers.at(-1)?.remote === "v=0 answer", "the SDP answer");
    peers.at(-1)!.channel.open();
    await until(() => vc.getSnapshot().phase === "LISTENING", "LISTENING");

    expect(phases).toEqual(["CONNECTING", "RECOVERY", "CONNECTING", "CONFIGURING", "LISTENING"]);
    expect(sessions()).toBe(2);
    expect(routeCalls("/api/session/sdp")).toHaveLength(1);
    // The first request's stream answered a torn-down connect and was stopped; the second one is in use.
    expect(mic.tracks.map((t) => t.stopped)).toEqual([true, false]);
    expect(vc.getSnapshot().error).toBeNull();
  });

  it("today: a rejected mic opens four Sessions and shows no mic message", async () => {
    const { vc, mic, timers, phases, routeCalls, sessions } = setup();
    mic.deny();
    vc.call();
    await until(() => mic.requests === 1, "the first mic request");

    // Reconnects at 1, 2 and 5 s after each failure; each opens a new Session and asks for the mic again.
    await timers.advance(20_000);
    expect(mic.requests).toBe(4);
    expect(routeCalls("/api/session/open")).toHaveLength(4);
    expect(sessions()).toBe(4);
    expect(routeCalls("/api/session/close").map((c) => c.body?.reason)).toEqual(["error", "error", "error", "error"]);
    expect(routeCalls("/api/session/sdp")).toHaveLength(0);
    const s = vc.getSnapshot();
    expect(s.phase).toBe("RECOVERY");
    expect(s.recovery).toMatchObject({ kind: "connection", attempts: 3 });
    expect(s.error).toBeNull();
    expect(s.retryVisible).toBe(false);
    expect(phases).toEqual(["CONNECTING", "RECOVERY", "CONNECTING", "RECOVERY", "CONNECTING", "RECOVERY", "CONNECTING", "RECOVERY"]);

    // No fifth attempt: only "Try again", RETRY_UI_MS after the first failure (at call start), still with no mic message.
    await timers.advance(RETRY_UI_MS - 20_000 - 1);
    expect(vc.getSnapshot().retryVisible).toBe(false);
    await timers.advance(1);
    expect(mic.requests).toBe(4);
    expect(vc.getSnapshot()).toMatchObject({ phase: "RECOVERY", retryVisible: true, error: null });
  });
});
