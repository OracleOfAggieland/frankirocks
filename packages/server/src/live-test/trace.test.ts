import { createFakeClock } from "@franki/core";
import { describe, expect, it } from "vitest";
import { decisionsPort } from "../intents/decisions-port";
import { runSlowParse } from "../intents/slow-parse";
import { FakeOpenAI, ok } from "../openai/fake";
import type { Log, RouteSpec } from "../routes/runtime";
import { callRoute, testRig } from "../testing/fakes";
import { fastSlotsFields, modelCallFields, traceFastSlots, tracedOpenAI, usageFields } from "./trace";

type Line = { event: string; fields: Record<string, unknown> };
const recorder = () => {
  const lines: Line[] = [];
  const log: Log = (event, fields) => lines.push({ event, fields });
  return { lines, log };
};

describe("model.call", () => {
  it("names the purpose from the schema, the model and the tools, never the input", () => {
    const body = { model: "gpt-x", input: "My dog is called Pip", text: { format: { type: "json_schema", name: "ExtractV1" } }, tools: [{ type: "function", name: "read_money" }] };
    expect(modelCallFields("responses.create", body)).toEqual({ purpose: "ExtractV1", endpoint: "responses.create", model: "gpt-x", tools: ["read_money"] });
    expect(modelCallFields("decisions.create", { model: "bg" })).toEqual({ purpose: "decisions.create", endpoint: "decisions.create", model: "bg" });
    expect(modelCallFields("realtime.calls.hangup", { callId: "c1" })).toEqual({ purpose: "realtime.calls.hangup", endpoint: "realtime.calls.hangup" });
    expect(modelCallFields("responses.create", null)).toEqual({ purpose: "responses.create", endpoint: "responses.create" });
  });

  it("reads tokens from the normalized usage and from an SDK-shaped one", () => {
    expect(usageFields({ status: "completed", usage: { inputTokens: 10, outputTokens: 3 } })).toEqual({ inTok: 10, outTok: 3, status: "completed" });
    expect(usageFields({ usage: { input_tokens: 7, output_tokens: 1 } })).toEqual({ inTok: 7, outTok: 1 });
    expect(usageFields(null)).toEqual({});
  });

  it("traces each request's time and outcome and passes answers and errors through", async () => {
    const clock = createFakeClock({ world: 0, ops: 0, zone: "UTC" });
    const inner = new FakeOpenAI();
    const answer = { status: "completed", outputText: "{}", refusal: null, usage: { inputTokens: 5, outputTokens: 2 } };
    inner.script("responses.create", ok(answer), { kind: "error", error: new TypeError("fetch failed: My dog") });
    const { lines, log } = recorder();
    const port = tracedOpenAI({ call: async (e, b, o) => { clock.advance(40); return inner.call(e, b, o); } }, log, clock);
    expect(await port.call("responses.create", { model: "m" })).toEqual(answer);
    await expect(port.call("responses.create", { model: "m" })).rejects.toThrow("fetch failed");
    expect(lines).toEqual([
      { event: "model.call", fields: { purpose: "responses.create", endpoint: "responses.create", model: "m", ms: 40, ok: true, inTok: 5, outTok: 2, status: "completed" } },
      { event: "model.call", fields: { purpose: "responses.create", endpoint: "responses.create", model: "m", ms: 40, ok: false, error: "TypeError" } },
    ]);
  });

  it("never lets a throwing trace break the call", async () => {
    const clock = createFakeClock({ world: 0, ops: 0, zone: "UTC" });
    const port = tracedOpenAI({ call: async () => 1 }, () => { throw new Error("disk"); }, clock);
    expect(await port.call("decisions.create", {})).toBe(1);
  });
});

describe("turn.fastSlots", () => {
  it("gives time, validity, reason and kinds", () => {
    expect(fastSlotsFields({ kind: "valid", out: { items: [{ kind: "allergy" } as never, { kind: "rule" } as never], need: "none" }, ms: 412 })).toEqual({ ms: 412, valid: true, kinds: ["allergy", "rule"], need: "none" });
    expect(fastSlotsFields({ kind: "invalid", reason: "shape", path: "$.items", ms: 30 })).toEqual({ ms: 30, valid: false, reason: "shape", kinds: [] });
    expect(fastSlotsFields({ kind: "timeout", ms: 900 })).toEqual({ ms: 900, valid: false, reason: "timeout", kinds: [] });
  });

  it("does nothing without a trace", () => {
    expect(() => traceFastSlots(undefined, { kind: "transport", ms: 1 }, {})).not.toThrow();
  });
});

describe("turn.slowParse", () => {
  it("traces the parse's time and outcome when the trace is set, and only then", async () => {
    const rig = testRig();
    const { lines, log } = recorder();
    const deps = { decisions: decisionsPort(rig.deps), env: rig.deps.env, log: rig.deps.log };
    const traced = await runSlowParse({ ...deps, trace: log }, { turnId: "t1", utterance: "what's for dinner" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ event: "turn.slowParse", fields: expect.objectContaining({ turnId: "t1", ms: traced.ms, ok: true, parse: traced.parse.kind, deadlineMs: expect.any(Number) }) });
    expect(JSON.stringify(lines)).not.toContain("dinner");
    const plain = await runSlowParse(deps, { turnId: "t2", utterance: "what's for dinner" });
    expect(plain.parse).toEqual(traced.parse);
    expect(lines).toHaveLength(1);
  });
});

describe("route.done", () => {
  const spec = (run: () => Promise<unknown>): RouteSpec<null> => ({ name: "probe", parse: () => null, run });

  it("traces one line per request on success and error, with the uid once the guard passed", async () => {
    const rig = testRig();
    const { lines, log } = recorder();
    rig.deps.trace = log;
    await callRoute(rig, spec(async () => ({ fine: true })), {});
    await callRoute(rig, spec(async () => { throw new TypeError("boom"); }), {});
    await callRoute(rig, spec(async () => ({})), {}, { token: null });
    const done = lines.filter((l) => l.event === "route.done").map((l) => l.fields);
    expect(done).toEqual([
      { route: "probe", method: "POST", status: 200, ms: expect.any(Number), uid: "owner-1" },
      { route: "probe", method: "POST", status: 503, code: "DEPENDENCY", ms: expect.any(Number), uid: "owner-1" },
      { route: "probe", method: "POST", status: 401, code: "AUTH", ms: expect.any(Number) },
    ]);
    expect(rig.logs.some((l) => l.event === "route.done")).toBe(false);
  });

  it("traces nothing when the recorder is off", async () => {
    const rig = testRig();
    const res = await callRoute(rig, spec(async () => ({ fine: true })), {});
    expect(res.status).toBe(200);
    expect(rig.deps.trace).toBeUndefined();
  });
});
