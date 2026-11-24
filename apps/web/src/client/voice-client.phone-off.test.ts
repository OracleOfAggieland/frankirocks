/* eslint-disable @typescript-eslint/no-explicit-any -- the test reads free-form Realtime and route JSON. */
/**
 * Brief 054 part D2 (R14.1): a demo visit's Voice_Client offers no phone tool, from the call's first `session.update`
 * on, before and after the first state poll; without `phoneOff` the lists are today's. The same harness as
 * `voice-client.test.ts`: a fake peer, data channel and microphone, and each request run through the real routes on
 * the Memory_Store with Fake_OpenAI and the fake Clock_Port. The server here sees an ordinary signed-in owner, so a
 * missing phone tool is the browser's own doing.
 */
import { testId } from "@franki/core/testing";
import { type RouteSpec, closeRoute, openRoute, receiptRoute, runRoute, sdpRoute, stateRoute, toolRoute, turnRoute } from "@franki/server";
import { describe, expect, it } from "vitest";
import { fail, ok } from "../../../../packages/server/src/openai/fake";
import { T0_MS, type TestRig, settle, testRig } from "../../../../packages/server/src/testing/fakes";
import { meetAlreadyHappened } from "../../../../packages/server/src/testing/meet";
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
  sent: any[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
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

/** Connects one call and lets the first state poll answer; returns each `session.update`'s tool names and Head. */
async function toolLists(phoneOff: boolean | undefined): Promise<{ lists: string[][]; instructions: string[] }> {
  const rig = testRig();
  await meetAlreadyHappened(rig.store, UID, rig.deps.hasher);
  rig.openai.respond("responses.create", () => fail(new Error("no model here")));
  rig.openai.script("realtime.calls.create", ok({ answerSdp: "v=0 answer", location: "/v1/realtime/calls/rtc_test1" }));
  rig.openai.always("realtime.calls.hangup", ok(null));
  const api = createApiClient({ getToken: async () => "token:owner-1", fetch: serverFetch(rig) });
  const clock = createBrowserClock({ zone: "America/Chicago", monotonic: { timeOrigin: T0_MS, now: () => rig.clock.read().opsClock.now - T0_MS } });
  const timers = virtualTimers(rig);
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
    getMicrophone: async (): Promise<StreamLike> => ({ getAudioTracks: () => [new FakeTrack()] }),
    newId: () => testId(`b${++n}`),
    ...(phoneOff === undefined ? {} : { phoneOff }),
  });
  vc.call();
  await until(() => peers.at(-1)?.remote === "v=0 answer", "the SDP answer");
  peers.at(-1)!.channel.open();
  await until(() => vc.getSnapshot().phase === "LISTENING", "LISTENING");
  // The first state poll, so a tools-only update follows when the catalog moves the list.
  await timers.advance(1_100);
  const updates = peers.at(-1)!.channel.sent.filter((e) => e.type === "session.update");
  return {
    lists: updates.map((u) => (u.session.tools ?? []).map((t: { name: string }) => t.name)),
    instructions: updates.map((u) => u.session.instructions).filter((i): i is string => typeof i === "string"),
  };
}

const PHONE_TOOLS = ["make_phone_call", "read_phone_result"];

describe("Voice_Client on a demo visit (brief 054 part D2, R14.1)", () => {
  it("phoneOff: the first session.update carries no phone tool, and neither does any update after the first poll", async () => {
    const { lists, instructions } = await toolLists(true);
    expect(lists.length).toBeGreaterThanOrEqual(2);
    expect(lists[0]).toEqual(["recall", "suggest", "answer", "read_money"]);
    for (const l of lists) for (const p of PHONE_TOOLS) expect(l).not.toContain(p);
    for (const i of instructions) expect(i).not.toContain("read_phone_result");
  });

  it("phoneOff absent or false: the tool lists are exactly today's", async () => {
    const today = await toolLists(undefined);
    expect(today.lists[0]).toEqual(["recall", "make_phone_call", "suggest", "answer", "read_money"]);
    expect(today.lists.some((l) => l.includes("read_phone_result"))).toBe(true);
    const off = await toolLists(false);
    expect(off).toEqual(today);
  });

  it("the machine holds phoneOff from construction, and only when it is true", () => {
    const rig = testRig();
    const base = {
      api: createApiClient({ getToken: async () => "token:owner-1", fetch: serverFetch(rig) }),
      clock: createBrowserClock({ zone: "UTC", monotonic: { timeOrigin: 0, now: () => 0 } }),
      transcribeModel: "m",
      audio: { muted: true, srcObject: null },
      createPeer: () => new FakePeer(),
      getMicrophone: async (): Promise<StreamLike> => ({ getAudioTracks: () => [] }),
    };
    expect(new VoiceClient({ ...base, phoneOff: true }).getSnapshot().phoneOff).toBe(true);
    expect(new VoiceClient({ ...base, phoneOff: false }).getSnapshot()).not.toHaveProperty("phoneOff");
    expect(new VoiceClient(base).getSnapshot()).not.toHaveProperty("phoneOff");
  });
});
