/* eslint-disable @typescript-eslint/no-explicit-any -- the test reads free-form Realtime and route JSON. */
/**
 * The Voice_Client against the real Server_Library routes (task 32). A fake RTCPeerConnection, data channel,
 * microphone and audio element stand in for WebRTC; the ApiClient's fetch runs each request through `runRoute`
 * on the Memory_Store with Fake_OpenAI and the fake Clock_Port. The browser clock reads the same virtual time as
 * the server, and the Voice_Client's timers run on that time. Permit hashes are computed with crypto.subtle, so
 * these tests also check that the browser's payload hash equals the one devAdmit approved.
 * Test-only imports of server test helpers; no browser module imports the Server_Library.
 */
import { type Session, type Turn, idParts } from "@franki/core";
import { testId } from "@franki/core/testing";
import { type RouteSpec, closeRoute, openRoute, receiptRoute, runRoute, sdpRoute, stateRoute, toolRoute, turnRoute } from "@franki/server";
import { describe, expect, it } from "vitest";
import { fail, ok } from "../../../../packages/server/src/openai/fake";
import { completed } from "../../../../packages/server/src/openai/responses";
import { paths } from "../../../../packages/server/src/store/paths";
import { commitUserTurnForTest, insertMemoryForTest } from "../../../../packages/server/src/testing/extract-fixtures";
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

/** Lets promises run until `cond` holds (or fails the test after many rounds). */
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 2_000 && !cond(); i++) await new Promise<void>((r) => setImmediate(r));
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
  await flush(5);
}

function serverFetch(rig: TestRig, hang: Set<string> = new Set()): FetchLike & { calls: { path: string; body: any }[] } {
  const calls: { path: string; body: any }[] = [];
  const f = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input, "http://localhost:3000");
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ path: url.pathname, body: body === "" ? null : JSON.parse(body) });
    if (hang.has(url.pathname)) return new Promise<Response>(() => {});
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
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}
class FakePeer implements PeerLike {
  connectionState = "new";
  channel = new FakeChannel();
  tracks: TrackLike[] = [];
  remote: string | null = null;
  closed = false;
  onconnectionstatechange: ((ev: unknown) => void) | null = null;
  ontrack: ((ev: { streams: readonly unknown[] }) => void) | null = null;
  addTrack(track: TrackLike) {
    this.tracks.push(track);
  }
  createDataChannel(label: string) {
    expect(label).toBe("oai-events");
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 offer" };
  }
  async setLocalDescription() {}
  async setRemoteDescription(d: { sdp: string }) {
    this.remote = d.sdp;
  }
  close() {
    this.closed = true;
  }
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

async function setup(opts: { hang?: string[]; hash?: (p: unknown) => Promise<string> } = {}) {
  const rig = testRig();
  // One Memory to recall; extraction requests fail, recall requests answer from `recallAnswer`.
  const t = await commitUserTurnForTest(rig.store, UID, testId("src"), "My dog is called Pip", rig.clock, rig.deps.hasher);
  const memId = await insertMemoryForTest(rig.store, UID, t, rig.deps.hasher);
  rig.openai.respond("responses.create", (body) =>
    (body as { model: string }).model === "test-bg-model"
      ? ok(completed(JSON.stringify({ kind: "supported", statements: [{ text: "The dog is Pip.", citations: [{ type: "memory", id: memId, rev: 1 }], memoryIds: [] }], alternatives: [] })))
      : fail(new Error("no extraction here")),
  );
  rig.openai.script("realtime.calls.create", ok({ answerSdp: "v=0 answer", location: "/v1/realtime/calls/rtc_test1" }));
  rig.openai.always("realtime.calls.hangup", ok(null));

  const fetch = serverFetch(rig, new Set(opts.hang ?? []));
  const api = createApiClient({ getToken: async () => "token:owner-1", fetch });
  const clock = createBrowserClock({ zone: "America/Chicago", monotonic: { timeOrigin: T0_MS, now: () => rig.clock.read().opsClock.now - T0_MS } });
  const timers = virtualTimers(rig);
  const track = new FakeTrack();
  const mic: StreamLike = { getAudioTracks: () => [track] };
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
    getMicrophone: async () => mic,
    newId: () => testId(`b${++n}`),
    ...(opts.hash === undefined ? {} : { hash: opts.hash as never }),
  });
  const peer = () => peers.at(-1)!;
  const sent = () => peer().channel.sent;
  const routeCalls = (path: string) => fetch.calls.filter((c) => c.path === path);

  /** Press call, let open and SDP finish, open the channel, let the ack arrive. */
  const connect = async () => {
    vc.call();
    await until(() => peers.at(-1)?.remote === "v=0 answer", "the SDP answer");
    expect(vc.getSnapshot().phase).toBe("CONNECTING");
    peer().channel.open();
    await until(() => vc.getSnapshot().phase === "LISTENING", "LISTENING");
  };
  /** One spoken line: committed, item.added, final transcript. */
  const speak = async (itemId: string, text: string) => {
    const ch = peer().channel;
    ch.emit({ type: "input_audio_buffer.speech_started", item_id: itemId, audio_start_ms: 1000 });
    ch.emit({ type: "input_audio_buffer.speech_stopped", item_id: itemId, audio_end_ms: 2200 });
    ch.emit({ type: "input_audio_buffer.committed", item_id: itemId });
    ch.emit({ type: "conversation.item.added", item: { id: itemId } });
    ch.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: itemId, transcript: text });
    // Done when the reply was created, or the Turn ended with no reply.
    await until(() => vc.getSnapshot().active !== null || (vc.getSnapshot().phase === "LISTENING" && vc.getSnapshot().turn === null), "the Turn's outcome");
  };
  return { rig, vc, peer, sent, routeCalls, track, audio, timers, connect, speak, memId };
}

const ofType = (events: any[], type: string) => events.filter((e) => e.type === type);

describe("Voice_Client", () => {
  it("one session.update with no model or voice; the offer goes only to /api/session/sdp", async () => {
    const { rig, sent, routeCalls, connect, peer, track } = await setup();
    await connect();
    const updates = ofType(sent(), "session.update");
    expect(updates).toHaveLength(1);
    expect(updates[0].session).not.toHaveProperty("model");
    expect(updates[0].session).not.toHaveProperty("voice");
    expect(updates[0].session).toMatchObject({ type: "realtime", tracing: null, audio: { input: { transcription: { model: "test-transcribe-model" } } } });
    expect(updates[0].session.tools.map((t: { name: string }) => t.name)).toEqual(["recall"]);
    expect(routeCalls("/api/session/sdp")).toHaveLength(1);
    expect(routeCalls("/api/session/sdp")[0]!.body).toMatchObject({ offerSdp: "v=0 offer", generation: 1 });
    expect(peer().tracks).toEqual([track]);
    const s = (await rig.store.get<Session>(UID, paths.session(UID, await sessionIdOf(rig))))!.data;
    expect(s.registeredCallIds).toEqual(["rtc_test1"]);
  });

  it("refresh every 45 s: /api/session/state again with the held Deck's revisions", async () => {
    const { routeCalls, connect, timers } = await setup();
    await connect();
    expect(routeCalls("/api/session/state")).toHaveLength(1);
    await timers.advance(44_000);
    expect(routeCalls("/api/session/state")).toHaveLength(1);
    await timers.advance(1_000);
    expect(routeCalls("/api/session/state")).toHaveLength(2);
    await timers.advance(45_000);
    expect(routeCalls("/api/session/state")).toHaveLength(3);
    expect(routeCalls("/api/session/state")[2]!.body).toMatchObject({ generation: 1, seen: { epoch: 1, policyRev: 1, rulesRev: 1 } });
  });

  it("response.create only after a verified Permit; audio unmutes only at first permitted audio; receipts reach the server", async () => {
    const { rig, vc, sent, routeCalls, connect, speak, audio, peer } = await setup();
    await connect();
    await speak("item_1", "What is my dog called");
    expect(routeCalls("/api/turn")).toHaveLength(1);
    expect(routeCalls("/api/turn")[0]!.body).toMatchObject({ source: "asr", judge: "timeout", transcriptState: "final", transcript: "What is my dog called", clientSeq: 1 });
    // The browser's hash of its own payload matched devAdmit's, so exactly one response.create went out.
    const creates = ofType(sent(), "response.create");
    expect(creates).toHaveLength(1);
    expect(creates[0].response).toMatchObject({ conversation: "none", input: [{ type: "item_reference", id: "item_1" }], metadata: { purpose: "speech", generation: "1" } });
    expect(audio.muted).toBe(true);

    const turnId = creates[0].response.metadata.turnId;
    peer().channel.emit({ type: "response.created", response: { id: "resp_1", metadata: { purpose: "speech", turnId, generation: "1" } } });
    peer().channel.emit({ type: "output_audio_buffer.started", response_id: "resp_1" });
    await flush();
    expect(audio.muted).toBe(false);
    expect(vc.getSnapshot().phase).toBe("SPEAKING");
    peer().channel.emit({ type: "response.output_audio_transcript.done", response_id: "resp_1", transcript: "Your dog is called Pip." });
    peer().channel.emit({ type: "output_audio_buffer.stopped", response_id: "resp_1" });
    await until(() => routeCalls("/api/receipt").length === 3, "three receipts");
    await flush(200);
    expect(audio.muted).toBe(true);
    expect(routeCalls("/api/receipt").map((c) => c.body.kind).sort()).toEqual(["playbackEnded", "playbackStarted", "transcript"]);
    const sessionId = await sessionIdOf(rig);
    const aturn = await rig.store.get<Turn>(UID, paths.turn(UID, sessionId, rig.deps.hasher.id(idParts.assistantTurn(sessionId, "resp_1"))));
    expect(aturn?.data).toMatchObject({ role: "assistant", seq: 1, text: "Your dog is called Pip." });
  });

  it("a Permit whose payload hash does not match plays nothing and sends no response.create", async () => {
    const { sent, connect, speak, audio, vc } = await setup({ hash: async () => "f".repeat(64) });
    await connect();
    await speak("item_1", "What is my dog called");
    expect(ofType(sent(), "response.create")).toHaveLength(0);
    expect(audio.muted).toBe(true);
    expect(vc.getSnapshot().phase).toBe("LISTENING");
  });

  it("recall: /api/tool, then one continuation response.create with function_call_output under the new Permit", async () => {
    const { vc, sent, routeCalls, connect, speak, peer } = await setup();
    await connect();
    await speak("item_1", "What is my dog called");
    const turnId = ofType(sent(), "response.create")[0].response.metadata.turnId;
    peer().channel.emit({ type: "response.created", response: { id: "resp_1", metadata: { purpose: "speech", turnId, generation: "1" } } });
    const args = JSON.stringify({ purpose: "answer", query: "dog", entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" });
    peer().channel.emit({ type: "response.function_call_arguments.done", response_id: "resp_1", call_id: "call_1", name: "recall", arguments: args });
    await until(() => ofType(sent(), "response.create").length === 2 || vc.getSnapshot().phase === "LISTENING", "the tool continuation");
    expect(routeCalls("/api/tool")).toHaveLength(1);
    const creates = ofType(sent(), "response.create");
    expect(creates).toHaveLength(2);
    const input = creates[1].response.input as { type: string; output?: string }[];
    expect(input.map((i) => i.type)).toEqual(["item_reference", "function_call", "function_call_output"]);
    expect(JSON.parse(input[2]!.output!).notes.map((n: { text: string }) => n.text)).toEqual(["The dog is Pip."]);
  });

  it("mute only touches the mic track", async () => {
    const { vc, connect, track, audio } = await setup();
    await connect();
    const before = audio.muted;
    vc.toggleMute();
    expect(track.enabled).toBe(false);
    expect(audio.muted).toBe(before);
    expect(vc.getSnapshot().micMuted).toBe(true);
    vc.toggleMute();
    expect(track.enabled).toBe(true);
  });

  it("sign-out closes within 5 s: mic stopped, peer closed, Session closed on the server", async () => {
    const { rig, vc, connect, track, peer, routeCalls } = await setup();
    await connect();
    const start = rig.clock.read().opsClock.now;
    await vc.signOut();
    expect(rig.clock.read().opsClock.now - start).toBeLessThanOrEqual(5_000);
    expect(track.stopped).toBe(true);
    expect(peer().closed).toBe(true);
    expect(peer().channel.readyState).toBe("closed");
    expect(routeCalls("/api/session/close")).toHaveLength(1);
    const s = (await rig.store.get<Session>(UID, paths.session(UID, await sessionIdOf(rig))))!.data;
    expect(s.status).toBe("closed");
    expect(rig.openai.requestsTo("realtime.calls.hangup").map((r) => r.body)).toEqual([{ callId: "rtc_test1" }]);
  });

  it("sign-out with a close that never answers still finishes after 5 s, with everything released locally", async () => {
    const { vc, connect, track, peer, timers } = await setup({ hang: ["/api/session/close"] });
    await connect();
    let done = false;
    void vc.signOut().then(() => (done = true));
    await flush();
    expect(track.stopped).toBe(true);
    expect(peer().closed).toBe(true);
    expect(done).toBe(false);
    await timers.advance(5_000);
    expect(done).toBe(true);
  });

  it("a data channel that closes without a hang-up mutes and goes to RECOVERY", async () => {
    const { vc, connect, peer, audio } = await setup();
    await connect();
    peer().channel.onclose?.({});
    await flush();
    expect(vc.getSnapshot().phase).toBe("RECOVERY");
    expect(audio.muted).toBe(true);
    expect(peer().closed).toBe(true);
  });
});

async function sessionIdOf(rig: TestRig): Promise<string> {
  const epoch = await rig.store.get<{ activeSessionId: string | null }>(UID, paths.core(UID, "epoch"));
  if (epoch?.data.activeSessionId != null) return epoch.data.activeSessionId;
  const rows = await rig.store.query<Session>(UID, { collection: paths.collection(UID, "sessions"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 10 });
  return rows[0]!.id;
}
