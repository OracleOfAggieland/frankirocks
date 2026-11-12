import { type VoiceState, initialVoiceState } from "@franki/core";
import { describe, expect, it } from "vitest";
import { PHONE_LINGER_MS, PHONE_POLL_MS } from "../ui/phone/phone-call";
import type { ApiCallOptions, ApiClient, ApiResult } from "./api";
import { PHONE_STATUS_PATH, PhoneWatch, pendingPhoneCall } from "./phone-watch";

const BASE = initialVoiceState({ transcribeModel: "test" });

/** A voice snapshot whose active reply has `tool` out at /api/tool for turn `turnId`. */
function withTool(tool: "make_phone_call" | "recall" | null, turnId = "t1"): VoiceState {
  if (tool === null) return BASE;
  const active = {
    permit: { stamp: { sessionId: "s1", turnId } },
    pendingTool: { callId: "c1", name: tool, arguments: "{}" },
  } as unknown as VoiceState["active"];
  return { ...BASE, active };
}

function harness(answers: (string | "throw" | "http")[]) {
  let now = 0;
  const calls: { path: string; options: ApiCallOptions | undefined }[] = [];
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let nextId = 1;
  const api: ApiClient = {
    async call<T>(path: string, options?: ApiCallOptions): Promise<ApiResult<T>> {
      calls.push({ path, options });
      const a = answers.shift() ?? "unknown";
      if (a === "throw") throw new Error("offline");
      if (a === "http") return { ok: false, kind: "http", status: 503, error: null, retryAfterMs: 0 };
      return { ok: true, status: 200, body: { status: a } as T };
    },
  };
  const watch = new PhoneWatch({
    api,
    now: () => now,
    timers: {
      setTimeout: (fn, ms) => {
        const id = nextId++;
        timers.push({ fn, at: now + ms, id });
        return id;
      },
      clearTimeout: (h) => {
        const i = timers.findIndex((t) => t.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
    },
  });
  watch.start();
  const seen: string[] = [];
  watch.subscribe(() => seen.push(watch.getSnapshot().phase));
  /** Runs the next due timer and lets its read settle. */
  const advance = async () => {
    timers.sort((a, b) => a.at - b.at);
    const t = timers.shift();
    if (t === undefined) return false;
    now = Math.max(now, t.at);
    t.fn();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    return true;
  };
  return { watch, calls, timers, seen, advance, clock: () => now };
}

describe("pendingPhoneCall", () => {
  it("names the turn only while a make_phone_call is out", () => {
    expect(pendingPhoneCall(withTool(null))).toBeNull();
    expect(pendingPhoneCall(withTool("recall"))).toBeNull();
    expect(pendingPhoneCall(withTool("make_phone_call", "t9"))).toEqual({ sessionId: "s1", turnId: "t9" });
  });
});

describe("PhoneWatch", () => {
  it("reads nothing and shows nothing until a call is known", () => {
    const h = harness([]);
    h.watch.onVoice(withTool(null));
    h.watch.onVoice(withTool("recall"));
    expect(h.timers).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
    expect(h.watch.getSnapshot().phase).toBe("absent");
  });

  it("follows a spoken call from the tool call to the hang-up, one read at a time, then takes the phone down", async () => {
    const h = harness(["none", "dialing", "ringing", "talking", "ended"]);
    h.watch.onVoice(withTool("make_phone_call"));
    expect(h.watch.getSnapshot()).toEqual({ phase: "dialing", reason: null });
    h.watch.onVoice(withTool("make_phone_call")); // the reducer publishes again: no second timer
    expect(h.timers).toHaveLength(1);
    await h.advance(); // none, while the tool is still out
    expect(h.watch.getSnapshot().phase).toBe("dialing");
    h.watch.onVoice(withTool(null)); // the tool came back
    for (let i = 0; i < 4; i++) await h.advance();
    expect(h.seen).toEqual(["dialing", "ringing", "talking", "ended"]);
    expect(h.calls).toHaveLength(5);
    expect(h.calls[0]).toMatchObject({ path: PHONE_STATUS_PATH, options: { method: "GET", query: { sessionId: "s1", turnId: "t1" } } });
    // Over: no more reads, one linger timer, then nothing.
    expect(h.timers).toHaveLength(1);
    const before = h.clock();
    await h.advance();
    expect(h.clock() - before).toBe(PHONE_LINGER_MS);
    expect(h.watch.getSnapshot().phase).toBe("absent");
    expect(h.timers).toHaveLength(0);
    expect(h.calls).toHaveLength(5);
  });

  it("reads a new call at once and then every poll interval", async () => {
    const h = harness(["ringing", "ringing"]);
    h.watch.onVoice(withTool("make_phone_call"));
    expect(h.timers[0]!.at).toBe(0);
    await h.advance();
    expect(h.timers[0]!.at).toBe(PHONE_POLL_MS);
  });

  it("probes once after a typed turn and stays off the screen when it placed no call", async () => {
    const h = harness(["none"]);
    h.watch.onTypedTurn({ sessionId: "s1", turnId: "t1" });
    expect(h.watch.getSnapshot().phase).toBe("absent");
    await h.advance();
    expect(h.calls).toHaveLength(1);
    expect(h.timers).toHaveLength(0);
    expect(h.seen).toEqual([]);
  });

  it("shows the phone for a typed turn that placed a call", async () => {
    const h = harness(["ringing"]);
    h.watch.onTypedTurn({ sessionId: "s1", turnId: "t1" });
    await h.advance();
    expect(h.watch.getSnapshot()).toEqual({ phase: "ringing", reason: null });
  });

  it("treats a failed, thrown or malformed read as unknown and keeps the phase", async () => {
    const h = harness(["talking", "http", "throw", "banana", "talking"]);
    h.watch.onVoice(withTool("make_phone_call"));
    h.watch.onVoice(withTool(null));
    for (let i = 0; i < 5; i++) await h.advance();
    expect(h.seen).toEqual(["dialing", "talking"]);
    expect(h.calls).toHaveLength(5);
  });

  it("stop clears the phone and reads nothing more; start makes it usable again", async () => {
    const h = harness(["talking", "ringing"]);
    h.watch.onVoice(withTool("make_phone_call"));
    await h.advance();
    h.watch.stop();
    expect(h.watch.getSnapshot().phase).toBe("absent");
    expect(h.timers).toHaveLength(0);
    h.watch.onVoice(withTool("make_phone_call", "t2"));
    expect(h.watch.getSnapshot().phase).toBe("absent");
    h.watch.start();
    h.watch.onVoice(withTool("make_phone_call", "t2"));
    expect(h.watch.getSnapshot().phase).toBe("dialing");
  });
});
