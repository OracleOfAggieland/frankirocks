/* eslint-disable @typescript-eslint/no-explicit-any -- the test reads free-form Realtime and route JSON. */
/**
 * The Voice_Client against the real Server_Library routes (task 32). A fake RTCPeerConnection, data channel,
 * microphone and audio element stand in for WebRTC; the ApiClient's fetch runs each request through `runRoute`
 * on the Memory_Store with Fake_OpenAI and the fake Clock_Port. The browser clock reads the same virtual time as
 * the server, and the Voice_Client's timers run on that time. Permit hashes are computed with crypto.subtle, so
 * these tests also check that the browser's payload hash equals the one the Admission_Seam approved.
 * Test-only imports of server test helpers; no browser module imports the Server_Library.
 */
import { COMPANY_LINE, LATENCY_SAMPLE_MS, LOUD_LEVEL, type Session, type Turn, ackNote, avatarState, callButton, idParts } from "@franki/core";
import { testId } from "@franki/core/testing";
import { type RouteSpec, closeRoute, openRoute, receiptRoute, runRoute, sdpRoute, stateRoute, toolRoute, turnRoute } from "@franki/server";
import { describe, expect, it } from "vitest";
import { fastODecisionId } from "../../../../packages/server/src/admission/seam";
import { fail, ok } from "../../../../packages/server/src/openai/fake";
import { completed } from "../../../../packages/server/src/openai/responses";
import { paths } from "../../../../packages/server/src/store/paths";
import { commitUserTurnForTest, insertMemoryForTest } from "../../../../packages/server/src/testing/extract-fixtures";
import { T0_MS, type TestRig, runScheduled, settle, testRig } from "../../../../packages/server/src/testing/fakes";
import { meetAlreadyHappened } from "../../../../packages/server/src/testing/meet";
import { callCardProps } from "../ui/call-cards";
import { type ApiClient, type FetchLike, createApiClient } from "./api";
import { CallCardShelf } from "./call-cards";
import { CompanyTap } from "./company-tap";
import { createBrowserClock } from "./clock";
import { permitPayloadHash } from "./hash";
import { type AudioLike, type ChannelLike, type PeerLike, type StreamLike, TURN_TIMEOUT_MS, type TimerApi, type TrackLike, VoiceClient, type VoiceClientDeps } from "./voice-client";

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

function serverFetch(rig: TestRig, hang: Set<string> = new Set()): FetchLike & { calls: { path: string; body: any; res?: any }[] } {
  const calls: { path: string; body: any; res?: any }[] = [];
  const f = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input, "http://localhost:3000");
    const body = typeof init.body === "string" ? init.body : "";
    const call: { path: string; body: any; res?: any } = { path: url.pathname, body: body === "" ? null : JSON.parse(body) };
    calls.push(call);
    if (hang.has(url.pathname)) return new Promise<Response>(() => {});
    const spec = ROUTES[url.pathname]!;
    const headers = new Map(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    headers.set("origin", "http://localhost:3000");
    const { value } = await settle(
      runRoute(spec, { method: init.method ?? "GET", url: url.href, header: (n) => headers.get(n.toLowerCase()) ?? null, text: async () => body }, rig.deps, rig.sched.schedule),
      rig.clock,
      rig.timers,
    );
    call.res = value.body;
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

async function setup(opts: { hang?: string[]; hash?: (p: unknown) => Promise<string>; inputLevel?: () => number; wrapApi?: (api: ApiClient, rig: TestRig) => ApiClient; onControlCheck?: () => void; onToolCards?: VoiceClientDeps["onToolCards"]; onAudience?: VoiceClientDeps["onAudience"] } = {}) {
  const rig = testRig();
  // Brief 052: the first meeting is over, so the call opens to LISTENING with no meet line to say first.
  await meetAlreadyHappened(rig.store, UID, rig.deps.hasher);
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
  const baseApi = createApiClient({ getToken: async () => "token:owner-1", fetch });
  const api = opts.wrapApi === undefined ? baseApi : opts.wrapApi(baseApi, rig);
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
    ...(opts.inputLevel === undefined ? {} : { inputLevel: opts.inputLevel }),
    ...(opts.onControlCheck === undefined ? {} : { onControlCheck: opts.onControlCheck }),
    ...(opts.onToolCards === undefined ? {} : { onToolCards: opts.onToolCards }),
    ...(opts.onAudience === undefined ? {} : { onAudience: opts.onAudience }),
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
  return { rig, vc, peer, sent, routeCalls, track, audio, timers, connect, speak, memId, fetch };
}

const ofType = (events: any[], type: string) => events.filter((e) => e.type === type);
/** The reply creates only: the judge and the speculative reply also go out at each commit (voice-control R2.1). */
const replyCreates = (events: any[]) => ofType(events, "response.create").filter((e) => e.response?.metadata?.purpose === "speech");
const specCreate = (events: any[]) => ofType(events, "response.create").find((e) => e.response?.metadata?.purpose === "speculative");
const judgeCreate = (events: any[]) => ofType(events, "response.create").find((e) => e.response?.metadata?.purpose === "judge");

describe("Voice_Client", () => {
  it("configures audio once, then updates only the tools when the specialist catalog arrives", async () => {
    const { rig, sent, routeCalls, connect, peer, track } = await setup();
    await connect();
    const updates = ofType(sent(), "session.update");
    expect(updates).toHaveLength(2);
    expect(Object.keys(updates[1].session).sort()).toEqual(["tools", "type"]);
    expect(updates[1].session.tools.map((t: { name: string }) => t.name)).toEqual(["recall", "suggest", "answer", "read_money", "read_phone_result", "search_web", "read_web_result"]);
    expect(updates[0].session).not.toHaveProperty("model");
    expect(updates[0].session).not.toHaveProperty("voice");
    expect(updates[0].session).toMatchObject({ type: "realtime", tracing: null, audio: { input: { transcription: { model: "test-transcribe-model" } } } });
    expect(updates[0].session.tools.map((t: { name: string }) => t.name)).toEqual(["recall", "make_phone_call", "suggest", "answer", "read_money"]); // start_errand only once a poll says an errand agent is ready (review fix R2)
    expect(routeCalls("/api/session/sdp")).toHaveLength(1);
    expect(routeCalls("/api/session/sdp")[0]!.body).toMatchObject({ offerSdp: "v=0 offer", generation: 1 });
    expect(peer().tracks).toEqual([track]);
    const s = (await rig.store.get<Session>(UID, paths.session(UID, await sessionIdOf(rig))))!.data;
    expect(s.registeredCallIds).toEqual(["rtc_test1"]);
  });

  it("polls /api/session/state once a second with the held Deck's revisions (voice-control R4.5)", async () => {
    const { routeCalls, connect, timers } = await setup();
    await connect();
    expect(routeCalls("/api/session/state")).toHaveLength(1);
    await timers.advance(900);
    expect(routeCalls("/api/session/state")).toHaveLength(1);
    await timers.advance(100);
    expect(routeCalls("/api/session/state")).toHaveLength(2);
    await timers.advance(1_000);
    expect(routeCalls("/api/session/state")).toHaveLength(3);
    expect(routeCalls("/api/session/state")[2]!.body).toMatchObject({ generation: 1, includeSpecialists: true, seen: { epoch: 1, policyRev: 1, rulesRev: 1 } });
  });

  it("the slow path plays the speculative reply when its hash matches the seam's Permit; audio unmutes only at its start; receipts reach the server", async () => {
    const { rig, vc, sent, routeCalls, connect, speak, audio, peer } = await setup();
    await connect();
    await speak("item_1", "What is my dog called");
    expect(routeCalls("/api/turn")).toHaveLength(1);
    expect(routeCalls("/api/turn")[0]!.body).toMatchObject({ source: "asr", judge: "timeout", transcriptState: "final", transcript: "What is my dog called", clientSeq: 1 });
    // The browser's hash of the speculative payload equals the slowOrdinary Permit's, so no reply is created fresh.
    expect(replyCreates(sent())).toHaveLength(0);
    const spec = specCreate(sent());
    expect(spec.response).toMatchObject({ conversation: "none", input: [{ type: "item_reference", id: "item_1" }], metadata: { purpose: "speculative", generation: "1" } });
    expect(vc.getSnapshot().pending?.permit.kind ?? vc.getSnapshot().active?.permit.kind).toBe("slowOrdinary");
    expect(audio.muted).toBe(true);

    const metadata = spec.response.metadata;
    peer().channel.emit({ type: "response.created", response: { id: "resp_1", metadata } });
    peer().channel.emit({ type: "output_audio_buffer.started", response_id: "resp_1" });
    await flush();
    expect(audio.muted).toBe(false);
    expect(vc.getSnapshot().phase).toBe("SPEAKING");
    peer().channel.emit({ type: "response.output_audio_transcript.done", response_id: "resp_1", transcript: "Your dog is called Pip." });
    peer().channel.emit({ type: "response.done", response: { id: "resp_1", metadata } });
    peer().channel.emit({ type: "output_audio_buffer.stopped", response_id: "resp_1" });
    await until(() => routeCalls("/api/receipt").filter((c) => c.body.kind !== "admitted").length === 3, "three receipts");
    await flush(200);
    expect(audio.muted).toBe(true);
    expect(
      routeCalls("/api/receipt")
        .map((c) => c.body.kind)
        .filter((k) => k !== "admitted")
        .sort(),
    ).toEqual(["playbackEnded", "playbackStarted", "transcript"]);
    const sessionId = await sessionIdOf(rig);
    const aturn = await rig.store.get<Turn>(UID, paths.turn(UID, sessionId, rig.deps.hasher.id(idParts.assistantTurn(sessionId, "resp_1"))));
    expect(aturn?.data).toMatchObject({ role: "assistant", seq: 1, text: "Your dog is called Pip." });
  });

  it("a spoken line that claims gone with no receipt asks the screen (brief 030 P1-7)", async () => {
    const asks: string[] = [];
    const { connect, speak, peer, routeCalls } = await setup({ onControlCheck: () => asks.push("pending") });
    await connect();
    await speak("item_1", "Forget my dog");
    const spec = specCreate(peer().channel.sent);
    const metadata = spec.response.metadata;
    peer().channel.emit({ type: "response.created", response: { id: "resp_1", metadata } });
    peer().channel.emit({ type: "output_audio_buffer.started", response_id: "resp_1" });
    peer().channel.emit({ type: "response.output_audio_transcript.done", response_id: "resp_1", transcript: "Done, that's deleted." });
    peer().channel.emit({ type: "response.done", response: { id: "resp_1", metadata } });
    peer().channel.emit({ type: "output_audio_buffer.stopped", response_id: "resp_1" });
    await until(() => routeCalls("/api/receipt").some((c) => c.body.kind === "transcript" && c.res !== undefined), "the transcript receipt");
    await flush(50);
    expect(asks).toEqual(["pending"]);
  });

  it("a Permit whose payload hash does not match plays nothing and sends no response.create", async () => {
    const { sent, connect, speak, audio, vc } = await setup({ hash: async () => "f".repeat(64) });
    await connect();
    await speak("item_1", "What is my dog called");
    expect(replyCreates(sent())).toHaveLength(0);
    expect(audio.muted).toBe(true);
    expect(vc.getSnapshot().phase).toBe("LISTENING");
  });

  it("recall: /api/tool, then one continuation response.create with function_call_output under the new Permit", async () => {
    const { vc, sent, routeCalls, connect, speak, peer } = await setup();
    await connect();
    await speak("item_1", "What is my dog called");
    const metadata = specCreate(sent()).response.metadata;
    peer().channel.emit({ type: "response.created", response: { id: "resp_1", metadata } });
    const args = JSON.stringify({ purpose: "answer", query: "dog", entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" });
    peer().channel.emit({ type: "response.function_call_arguments.done", response_id: "resp_1", call_id: "call_1", name: "recall", arguments: args });
    await until(() => replyCreates(sent()).length === 1 || vc.getSnapshot().phase === "LISTENING", "the tool continuation");
    expect(routeCalls("/api/tool")).toHaveLength(1);
    // The speculative reply carried the call; the continuation is the only reply created fresh.
    const creates = replyCreates(sent());
    expect(creates).toHaveLength(1);
    const input = creates[0].response.input as { type: string; output?: string }[];
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

  it("sign-out closes within 5 s: mic stopped, peer closed, Session closed on the server after its hangup", async () => {
    const { rig, vc, connect, track, peer, routeCalls } = await setup();
    await connect();
    const start = rig.clock.read().opsClock.now;
    await vc.signOut();
    expect(rig.clock.read().opsClock.now - start).toBeLessThanOrEqual(5_000);
    expect(track.stopped).toBe(true);
    expect(peer().closed).toBe(true);
    expect(peer().channel.readyState).toBe("closed");
    expect(routeCalls("/api/session/close")).toHaveLength(1);
    // The close answers `closing`; the hangup runs after the response.
    await runScheduled(rig);
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

  // Brief 040, item 3: a pasted line in a call goes to /api/turn as pasted, as a pasted line with no call open does.
  it("a pasted line in a call is posted with source pasted", async () => {
    const { vc, connect, routeCalls } = await setup();
    await connect();
    expect(vc.sendTyped("I'm allergic to sesame", "pasted")).toBe(true);
    await until(() => routeCalls("/api/turn").length === 1, "the pasted line's post");
    expect(routeCalls("/api/turn")[0]!.body).toMatchObject({ source: "pasted", transcript: "I'm allergic to sesame", judge: "typed" });
  });
});

async function sessionIdOf(rig: TestRig): Promise<string> {
  const epoch = await rig.store.get<{ activeSessionId: string | null }>(UID, paths.core(UID, "epoch"));
  if (epoch?.data.activeSessionId != null) return epoch.data.activeSessionId;
  const rows = await rig.store.query<Session>(UID, { collection: paths.collection(UID, "sessions"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 10 });
  return rows[0]!.id;
}

// voice-control task 40: the judge, speculation, polling and the late transcript through the Voice_Client.
describe("Voice_Client with the judge (voice-control R2.8, R3.7, R4.5, R7.5, R7.8, R18.1, R18.5)", () => {
  const judgeDone = (id: string, metadata: unknown, letter: string) => ({
    type: "response.done",
    response: { id, status: "completed", metadata, output: [{ type: "message", content: [{ type: "output_text", text: letter }] }] },
  });

  /** Commit and item.added for one item, with no transcript yet; the judge and the speculative reply go out. */
  async function commit(ctx: Awaited<ReturnType<typeof setup>>, itemId: string) {
    const ch = ctx.peer().channel;
    ch.emit({ type: "input_audio_buffer.speech_started", item_id: itemId, audio_start_ms: 1000 });
    ch.emit({ type: "input_audio_buffer.speech_stopped", item_id: itemId, audio_end_ms: 2200 });
    ch.emit({ type: "input_audio_buffer.committed", item_id: itemId });
    ch.emit({ type: "conversation.item.added", item: { id: itemId } });
    await until(() => specCreate(ctx.sent()) !== undefined && judgeCreate(ctx.sent()) !== undefined, "the judge and the speculative reply");
    const judge = judgeCreate(ctx.sent());
    const spec = specCreate(ctx.sent());
    ch.emit({ type: "response.created", response: { id: "resp_j", metadata: judge.response.metadata } });
    ch.emit({ type: "response.created", response: { id: "resp_s", metadata: spec.response.metadata } });
    await until(() => ctx.vc.getSnapshot().spec?.hash != null, "the speculative payload hash");
    return { judge, spec, ch };
  }

  it("an ordinary turn on fastO: judge and spec sent, admitted receipt, unmute at the spec's start, and the browser's hash equals the seam's", async () => {
    const ctx = await setup();
    const { rig, vc, routeCalls, audio, connect } = ctx;
    await connect();
    await until(() => vc.getSnapshot().ack !== null, "a StateAck");
    const { judge, spec, ch } = await commit(ctx, "item_1");
    expect(judge.event_id).toMatch(/^judge:/);
    expect(spec.event_id).toMatch(/^spec:/);
    const specHash = vc.getSnapshot().spec!.hash!;
    ch.emit(judgeDone("resp_j", judge.response.metadata, "O"));
    await until(() => routeCalls("/api/receipt").some((c) => c.body.kind === "admitted"), "the admitted receipt");
    expect(routeCalls("/api/receipt").find((c) => c.body.kind === "admitted")!.body).toMatchObject({ permitKind: "fastO", responseId: "resp_s" });
    expect(replyCreates(ctx.sent())).toHaveLength(0);
    expect(audio.muted).toBe(true);
    ch.emit({ type: "output_audio_buffer.started", response_id: "resp_s" });
    await flush();
    expect(audio.muted).toBe(false);
    expect(vc.getSnapshot().phase).toBe("SPEAKING");

    // The transcript arrives; the server's slowOrdinary Permit hashes the same payload the browser did.
    ch.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "What is my dog called" });
    await until(() => routeCalls("/api/turn").some((c) => c.res !== undefined), "the turn response");
    const turn = routeCalls("/api/turn")[0]!;
    expect(turn.body).toMatchObject({ judge: "O", transcriptState: "final" });
    expect(turn.res.permit).toMatchObject({ kind: "slowOrdinary", approvedPayloadHash: specHash });
    const sessionId = await sessionIdOf(rig);
    expect(await rig.store.get(UID, paths.ledger(UID, fastODecisionId(rig.deps.hasher, sessionId, spec.response.metadata.turnId)))).not.toBeNull();
  });

  it("a false hold plays under slowOrdinary with matching hashes", async () => {
    const ctx = await setup();
    const { vc, routeCalls, connect } = ctx;
    await connect();
    const { judge, ch } = await commit(ctx, "item_1");
    ch.emit(judgeDone("resp_j", judge.response.metadata, "H"));
    await flush();
    expect(vc.getSnapshot().phase).toBe("HELD");
    ch.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "What is my dog called" });
    await until(() => replyCreates(ctx.sent()).length === 1 || vc.getSnapshot().phase === "LISTENING", "the reply");
    expect(routeCalls("/api/turn")[0]!.body).toMatchObject({ judge: "H" });
    const permit = routeCalls("/api/turn")[0]!.res.permit;
    expect(permit.kind).toBe("slowOrdinary");
    // A reply is created only after the browser's hash of its payload equals the Permit's.
    expect(replyCreates(ctx.sent())).toHaveLength(1);
    expect(vc.getSnapshot().active?.permit.approvedPayloadHash ?? vc.getSnapshot().pending?.permit.approvedPayloadHash).toBe(permit.approvedPayloadHash);
  });

  it("error events with an event_id reach the machine", async () => {
    const ctx = await setup();
    await ctx.connect();
    const { spec, ch } = await commit(ctx, "item_1");
    ch.emit({ type: "error", event_id: "evt_server_1", error: { type: "invalid_request_error", code: "conversation_already_has_active_response", message: "busy", event_id: spec.event_id } });
    await flush();
    expect(ctx.vc.getSnapshot().spec?.failed).toBe(true);
  });

  it("stateOk carries sentAt; one poll a second, never two in flight", async () => {
    // Every poll after the first never answers.
    let polls = 0;
    const ctx = await setup({
      wrapApi: (api) => ({ call: (path, o) => (path === "/api/session/state" && ++polls > 1 ? new Promise(() => {}) : api.call(path, o)) }),
    });
    const { rig, timers } = ctx;
    await ctx.connect();
    expect(polls).toBe(1);
    await timers.advance(1_000);
    expect(polls).toBe(2);
    await timers.advance(3_000);
    // The second poll never answers, so no third one goes out.
    expect(polls).toBe(2);

    const ok = await setup();
    const okEvents: any[] = [];
    const okDispatch = ok.vc.dispatch.bind(ok.vc);
    ok.vc.dispatch = (e) => (okEvents.push(e), okDispatch(e));
    const sentAt = ok.rig.clock.read().opsClock.now;
    await ok.connect();
    await until(() => okEvents.some((e) => e.type === "stateOk"), "a stateOk");
    const first = okEvents.find((e) => e.type === "stateOk");
    expect(typeof first.sentAt).toBe("number");
    expect(first.sentAt).toBeGreaterThanOrEqual(sentAt);
    expect(first.sentAt).toBeLessThanOrEqual(ok.rig.clock.read().opsClock.now);
    expect(rig).toBeDefined();
  });

  it("lastLoudAt comes from 20 ms samples at LOUD_LEVEL and goes with the commit", async () => {
    let level = 0;
    const ctx = await setup({ inputLevel: () => level });
    const events: any[] = [];
    const dispatch = ctx.vc.dispatch.bind(ctx.vc);
    ctx.vc.dispatch = (e) => (events.push(e), dispatch(e));
    await ctx.connect();
    level = LOUD_LEVEL;
    await ctx.timers.advance(LATENCY_SAMPLE_MS);
    const loudAt = ctx.rig.clock.read().opsClock.now;
    level = LOUD_LEVEL - 0.001;
    await ctx.timers.advance(LATENCY_SAMPLE_MS * 5);
    expect(ctx.rig.clock.read().opsClock.now).toBe(loudAt + LATENCY_SAMPLE_MS * 5);
    ctx.peer().channel.emit({ type: "input_audio_buffer.committed", item_id: "item_1" });
    await flush();
    const committed = events.find((e) => e.type === "realtime" && e.event.type === "input_audio_buffer.committed");
    expect(committed.lastLoudAt).toBe(loudAt);
  });

  it("TURN_TIMEOUT_MS is 5,000 and retries stop inside it", async () => {
    expect(TURN_TIMEOUT_MS).toBe(5_000);
    const asked: { at: number; timeoutMs: number }[] = [];
    let mode: "timeout" | "network" = "timeout";
    const ctx = await setup({
      wrapApi: (api, rig) => ({
        call: async (path, o) => {
          if (path !== "/api/turn") return api.call(path, o);
          const at = rig.clock.read().opsClock.now;
          asked.push({ at, timeoutMs: o?.timeoutMs ?? -1 });
          if (mode === "network") return { ok: false, kind: "network" } as never;
          rig.clock.advance(o!.timeoutMs!);
          return { ok: false, kind: "timeout" } as never;
        },
      }),
    });
    await ctx.connect();
    const start = ctx.rig.clock.read().opsClock.now;
    const ch = ctx.peer().channel;
    ch.emit({ type: "input_audio_buffer.committed", item_id: "item_1" });
    ch.emit({ type: "conversation.item.added", item: { id: "item_1" } });
    ch.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "What is my dog called" });
    await until(() => asked.length === 1 && ctx.vc.getSnapshot().outstanding.length === 0, "the turn to fail");
    // A request that used the whole budget is not retried.
    expect(asked.map((a) => a.timeoutMs)).toEqual([5_000]);
    expect(ctx.rig.clock.read().opsClock.now - start).toBeLessThanOrEqual(5_000);

    // Fast transient failures retry, each inside what is left of the budget.
    mode = "network";
    asked.length = 0;
    const ctx2 = await setup({
      wrapApi: (api, rig) => ({
        call: async (path, o) => {
          if (path !== "/api/turn") return api.call(path, o);
          asked.push({ at: rig.clock.read().opsClock.now, timeoutMs: o?.timeoutMs ?? -1 });
          return { ok: false, kind: "network" } as never;
        },
      }),
    });
    await ctx2.connect();
    const start2 = ctx2.rig.clock.read().opsClock.now;
    ctx2.peer().channel.emit({ type: "input_audio_buffer.committed", item_id: "item_1" });
    ctx2.peer().channel.emit({ type: "conversation.item.added", item: { id: "item_1" } });
    ctx2.peer().channel.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "hello there" });
    await until(() => asked.length >= 1, "the first post");
    await ctx2.timers.advance(1_000);
    expect(asked.length).toBe(3);
    for (const a of asked) expect(a.at - start2 + a.timeoutMs).toBeLessThanOrEqual(5_000);
  });

  it("a superseding post that is answered hold is resent inside the turn budget, with no reconnect (review item 19)", async () => {
    let held = false;
    const sup: string[] = [];
    const ctx = await setup({
      wrapApi: (api) => ({
        call: (path, o) => {
          const body = o?.body as { supersedesRequestId?: string | null } | undefined;
          if (path === "/api/turn" && body?.supersedesRequestId != null) {
            sup.push(body.supersedesRequestId);
            // The first try names a request the server can't see yet, as when the missing post is still running.
            if (!held) {
              held = true;
              return api.call(path, { ...o!, body: { ...body, supersedesRequestId: testId("not-visible-yet") } });
            }
          }
          return api.call(path, o);
        },
      }),
    });
    const { vc, routeCalls, timers, connect } = ctx;
    await connect();
    const { ch } = await commit(ctx, "item_1");
    await timers.advance(2_500);
    await until(() => routeCalls("/api/turn").length === 1 && routeCalls("/api/turn")[0]!.res !== undefined, "the missing post");
    ch.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "my dog loves the park" });
    await until(() => routeCalls("/api/turn").length === 2, "the first superseding post");
    expect(routeCalls("/api/turn")[1]!.res).toMatchObject({ status: "hold", retryAfterMs: 250 });
    await timers.advance(300);
    await until(() => routeCalls("/api/turn").length === 3 && routeCalls("/api/turn")[2]!.res !== undefined, "the resent superseding post");
    expect(routeCalls("/api/turn")[2]!.res).toMatchObject({ status: "ordinary", permit: null });
    expect(sup).toHaveLength(2);
    expect(vc.getSnapshot().recovery?.kind).not.toBe("connection");
  });

  it("a superseding post goes to /api/turn with the first request's ID and speaks nothing", async () => {
    const ctx = await setup();
    const { vc, routeCalls, timers, connect } = ctx;
    await connect();
    const { ch } = await commit(ctx, "item_1");
    // No transcript by t0 + 2,500: the Turn is posted missing.
    await timers.advance(2_500);
    await until(() => routeCalls("/api/turn").length === 1 && routeCalls("/api/turn")[0]!.res !== undefined, "the missing post");
    const first = routeCalls("/api/turn")[0]!;
    expect(first.body).toMatchObject({ transcriptState: "missing", transcript: "", supersedesRequestId: null });
    // The missing post's own answer plays the Neutral_Line once its hash check returns, which under full-suite load
    // can come after this point. Wait for that check, and assert it is that line, before counting.
    await until(() => vc.getSnapshot().pending === null, "the missing post's Neutral_Line check");
    const lines = replyCreates(ctx.sent());
    expect(lines).toHaveLength(1);
    expect(lines[0].response).toMatchObject({ instructions: 'Say exactly this and nothing else: "Sorry, say that again?"', tools: [], metadata: { turnId: first.body.turnId } });
    const createsBefore = lines.length;
    ch.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "my dog loves the park" });
    await until(() => routeCalls("/api/turn").length === 2 && routeCalls("/api/turn")[1]!.res !== undefined, "the superseding post");
    const late = routeCalls("/api/turn")[1]!;
    expect(late.body).toMatchObject({ turnId: first.body.turnId, clientSeq: first.body.clientSeq, transcriptState: "final", transcript: "my dog loves the park", supersedesRequestId: first.body.requestId });
    expect(late.body.requestId).not.toBe(first.body.requestId);
    expect(late.res).toMatchObject({ status: "ordinary", permit: null });
    await flush(50);
    expect(replyCreates(ctx.sent())).toHaveLength(createsBefore);
    expect(vc.getSnapshot().missing).toHaveLength(0);
  });
});

// voice-control task 52 (R14.3, R14.4, R14.6): the call swap through the Voice_Client. The server half of the
// audience wave (tasks 48 and 50) is not built yet, so the `blocked` answer and the open's `proactive` swap line
// are faked over the real routes' answers, in the wire shapes the spec gives.
describe("Voice_Client call swap (voice-control R14.3, R14.4, R14.6)", () => {
  /** Answers the first /api/turn `blocked` and the open after it with the COMPANY line in `proactive`. */
  function swapApi(opts: { failSwapOpen?: boolean } = {}) {
    let blockedOnce = false;
    let opens = 0;
    return (api: ApiClient): ApiClient => ({
      call: async (path: string, o?: Parameters<ApiClient["call"]>[1]) => {
        if (path === "/api/session/open" && ++opens === 2 && opts.failSwapOpen === true) return { ok: false, kind: "http", status: 503, error: null, retryAfterMs: 0 } as const;
        const r = await api.call<any>(path, o);
        if (path === "/api/turn" && !blockedOnce && r.ok) {
          blockedOnce = true;
          return { ...r, body: { ...r.body, status: "blocked", permit: null, notes: [], cards: [], pendingId: null, question: null, retryAfterMs: 0, receiptId: null, error: null } } as never;
        }
        if (path === "/api/session/open" && opens === 2 && r.ok && r.body.deck !== null) {
          const deck = r.body.deck;
          const turnId = testId("swapline");
          const whisper = ackNote(COMPANY_LINE, testId("swapnote"), deck.expiresAt);
          const stamp = { sessionId: r.body.sessionId, epoch: deck.epoch, policyRev: deck.policyRev, bundleRev: deck.bundleRev, rulesRev: deck.rulesRev, generation: r.body.generation, turnId };
          const approvedPayloadHash = await permitPayloadHash({ stamp, head: deck.head, notes: [whisper], turns: deck.turns, audioIds: [], toolOutput: null });
          const permit = { permitId: testId("swappermit"), stamp, kind: "postCommitControl", scope: "ack", approvedPayloadHash, noteIds: [whisper.noteId], momentIds: [], expiresAt: deck.expiresAt };
          return { ...r, body: { ...r.body, proactive: { turnId, permit, whisper, cards: [] } } } as never;
        }
        return r as never;
      },
    });
  }

  /** Records the avatar and the call button on every state change. */
  function watch(vc: VoiceClient) {
    const seen: { phase: string; avatar: string; button: string }[] = [];
    vc.subscribe(() => {
      const st = vc.getSnapshot();
      seen.push({ phase: st.phase, avatar: avatarState(st), button: callButton(st).form });
    });
    return seen;
  }

  it("a company line ends in a fresh call whose first audio is the COMPANY line, with no close from the browser, hang-up shown and thinking throughout", async () => {
    const ctx = await setup({ wrapApi: swapApi() });
    const { vc, peer, routeCalls, connect, rig, audio, timers } = ctx;
    rig.openai.script("realtime.calls.create", ok({ answerSdp: "v=0 answer", location: "/v1/realtime/calls/rtc_test2" }));
    await connect();
    const first = peer();
    const narrowed = vc.getSnapshot().session!.sessionId;
    const seen = watch(vc);
    expect(vc.sendTyped("my cousin just sat down", "typed")).toBe(true);
    await until(() => vc.getSnapshot().phase === "SWAPPING", "SWAPPING");
    const from = seen.findIndex((x) => x.phase === "SWAPPING");
    // The old call is torn down here, in the browser, and no close is posted (R14.3).
    expect(first.closed).toBe(true);
    expect(audio.muted).toBe(true);
    await until(() => routeCalls("/api/session/open").length === 2 && peer() !== first && peer().remote === "v=0 answer", "the fresh call's SDP answer");
    expect(routeCalls("/api/session/open")[1]!.body).toMatchObject({ previousSessionId: narrowed });
    // Real time passes before the fresh channel opens; an ack asked at the very instant of the blocked answer is
    // dropped as stale by R4.4.
    await timers.advance(50);
    peer().channel.open();
    await until(() => replyCreates(peer().channel.sent).length === 1, "the swap line's response.create");
    const line = replyCreates(peer().channel.sent)[0];
    expect(line.response).toMatchObject({ tools: [], instructions: expect.stringContaining(COMPANY_LINE) });
    expect(audio.muted).toBe(true);
    peer().channel.emit({ type: "response.created", response: { id: "resp_line", metadata: line.response.metadata } });
    await flush();
    const upTo = seen.length;
    peer().channel.emit({ type: "output_audio_buffer.started", response_id: "resp_line" });
    await until(() => !audio.muted, "the swap line's audio");
    expect(vc.getSnapshot().phase).toBe("SPEAKING");
    // From the blocked answer until the swap line is heard: thinking, and the call button stays "hang up" (R14.4).
    const during = seen.slice(from, upTo);
    expect(during.length).toBeGreaterThan(2);
    for (const x of during) expect(x).toMatchObject({ avatar: "thinking", button: "hangup" });
    expect(routeCalls("/api/session/close")).toHaveLength(0);
    // Nothing of the narrowed call was played: its only reply create was none.
    expect(replyCreates(first.channel.sent)).toHaveLength(0);
  });

  it("a failed swap shows recovery, and the reconnect names the narrowed Session", async () => {
    const ctx = await setup({ wrapApi: swapApi({ failSwapOpen: true }) });
    const { vc, routeCalls, connect, timers } = ctx;
    await connect();
    const narrowed = vc.getSnapshot().session!.sessionId;
    vc.sendTyped("my cousin just sat down", "typed");
    await until(() => vc.getSnapshot().phase === "RECOVERY", "RECOVERY");
    expect(vc.getSnapshot().recovery?.kind).toBe("connection");
    expect(avatarState(vc.getSnapshot())).toBe("recovery");
    expect(routeCalls("/api/session/close")).toHaveLength(0);
    await timers.advance(5_000);
    // The failed swap open never reached the server, so the server's second open is the reconnect.
    await until(() => routeCalls("/api/session/open").length >= 2, "the reconnect's open");
    expect(routeCalls("/api/session/open")[1]!.body).toMatchObject({ previousSessionId: narrowed });
  });
});

// Brief 044, item 1: a tool answer's cards go to the screen, only while the call's Session and generation still fit.
describe("Voice_Client: cards from a tool answer (brief 044, item 1)", () => {
  const card = (id: string, title: string) => ({ id: testId(id), kind: "food", title, lines: ["A line to read."], sources: [], sens: "S0" });
  /** Answers /api/tool with two cards on the real result; `gate` holds the answer until it resolves. */
  function cardsApi(gate: Promise<void> | null = null) {
    return (api: ApiClient): ApiClient => ({
      call: async (path: string, o?: Parameters<ApiClient["call"]>[1]) => {
        const r = await api.call<any>(path, o);
        if (path !== "/api/tool" || !r.ok || r.body.result === null) return r as never;
        if (gate !== null) await gate;
        return { ...r, body: { ...r.body, result: { ...r.body.result, cards: [card("dinners", "Three quick dinners"), card("groceries", "Grocery list")] } } } as never;
      },
    });
  }
  const recallArgs = JSON.stringify({ purpose: "answer", query: "dog", entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" });

  it("an `answer` answer with two cards puts both in the screen's model, with the call's stamp", async () => {
    const shown: { titles: string[]; sessionId: string; generation: number }[] = [];
    const shelf = new CallCardShelf();
    const { vc, sent, routeCalls, connect, speak, peer } = await setup({
      wrapApi: cardsApi(),
      onToolCards: (cards, stamp) => {
        shown.push({ titles: cards.map((c) => c.title), sessionId: stamp.sessionId, generation: stamp.generation });
        shelf.show(cards, stamp);
      },
    });
    await connect();
    await speak("item_1", "Yes please");
    const metadata = specCreate(sent()).response.metadata;
    peer().channel.emit({ type: "response.created", response: { id: "resp_1", metadata } });
    peer().channel.emit({ type: "response.function_call_arguments.done", response_id: "resp_1", call_id: "call_1", name: "answer", arguments: "{}" });
    await until(() => replyCreates(sent()).length === 1 || vc.getSnapshot().phase === "LISTENING", "the tool continuation");
    expect(routeCalls("/api/tool")).toHaveLength(1);
    expect(routeCalls("/api/tool")[0]!.body.tool.name).toBe("answer");
    const session = vc.getSnapshot().session!;
    expect(shown).toEqual([{ titles: ["Three quick dinners", "Grocery list"], sessionId: session.sessionId, generation: session.generation }]);
    expect(callCardProps(shelf.getSnapshot()).map((c) => c.title)).toEqual(["Three quick dinners", "Grocery list"]);
    // The cards are faked onto the real result after the server hashed it, so the Permit no longer matches and
    // the machine plays nothing: it still got the answer (it left TOOL_WAIT) and holds no card of its own.
    expect(vc.getSnapshot().phase).not.toBe("TOOL_WAIT");
    expect(JSON.stringify(vc.getSnapshot())).not.toContain("Three quick dinners");
  });

  it("an answer that arrives after a hang-up shows nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const shown: string[][] = [];
    const { vc, sent, routeCalls, connect, speak, peer } = await setup({ wrapApi: cardsApi(gate), onToolCards: (cards) => shown.push(cards.map((c) => c.title)) });
    await connect();
    await speak("item_1", "What is my dog called");
    const metadata = specCreate(sent()).response.metadata;
    peer().channel.emit({ type: "response.created", response: { id: "resp_1", metadata } });
    peer().channel.emit({ type: "response.function_call_arguments.done", response_id: "resp_1", call_id: "call_1", name: "recall", arguments: recallArgs });
    await until(() => routeCalls("/api/tool").length === 1, "the tool post");
    vc.hangUp();
    expect(vc.getSnapshot().phase).toBe("CLOSED");
    release();
    await flush(200);
    expect(shown).toEqual([]);
  });
});

describe("Voice_Client: the confirmed audience on the open's and the state poll's answers (brief 045 part S)", () => {
  it("the open and each state answer of the call's own Session tell the toggle; the next poll after company moves it", async () => {
    const seen: { sessionId: string; audience: unknown }[] = [];
    const tap = new CompanyTap({ api: { call: async () => ({ ok: false, kind: "network" }) as never }, newId: () => testId("x"), worldNow: () => 0, stampFor: async () => "none", adoptTypedStamp: () => {} });
    const { rig, vc, connect, timers } = await setup({
      onAudience: (stamp, audience) => {
        seen.push({ sessionId: stamp.sessionId, audience });
        tap.adopt(stamp, audience);
      },
    });
    await connect();
    const id = vc.getSnapshot().session!.sessionId;
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every((x) => x.sessionId === id && x.audience === "private")).toBe(true);
    expect(tap.getSnapshot().company).toBe(false);
    // The Session is now company on the server (a company line in words: see the server's audience-on-answers test).
    await rig.store.transaction(UID, async (tx) => {
      const doc = (await tx.get<Session>(paths.session(UID, id)))!;
      tx.update(paths.session(UID, id), { ...doc.data, audience: "company" });
    });
    await timers.advance(1_000);
    expect(seen.at(-1)).toEqual({ sessionId: id, audience: "company" });
    expect(tap.getSnapshot().company).toBe(true);
  });
});
