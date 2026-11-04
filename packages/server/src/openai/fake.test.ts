import { describe, expect, it } from "vitest";
import { FakeOpenAI, FakeOpenAIUnscriptedError, fail, never, ok } from "./fake";

describe("Fake_OpenAI", () => {
  it("records requests and returns scripted results in order", async () => {
    const fake = new FakeOpenAI().script("responses.create", ok({ id: "r1" }), ok({ id: "r2" }));
    const body = { model: "configured-model", input: "hi" };
    expect(await fake.call("responses.create", body)).toEqual({ id: "r1" });
    body.input = "changed after the call";
    expect(await fake.call("responses.create", { model: "configured-model" })).toEqual({ id: "r2" });
    expect(fake.requests).toEqual([
      { endpoint: "responses.create", body: { model: "configured-model", input: "hi" }, index: 0 },
      { endpoint: "responses.create", body: { model: "configured-model" }, index: 1 },
    ]);
  });

  it("rejects scripted errors and unscripted calls", async () => {
    const fake = new FakeOpenAI().script("realtime.calls.hangup", fail(new Error("gone")));
    await expect(fake.call("realtime.calls.hangup", {})).rejects.toThrow("gone");
    await expect(fake.call("realtime.calls.hangup", {})).rejects.toBeInstanceOf(FakeOpenAIUnscriptedError);
    expect(fake.requestsTo("realtime.calls.hangup")).toHaveLength(2);
  });

  it("uses the fallback once the queue is empty, and never settles for never()", async () => {
    const fake = new FakeOpenAI().script("responses.create", ok(1)).always("responses.create", ok(2));
    expect(await fake.call("responses.create", {})).toBe(1);
    expect(await fake.call("responses.create", {})).toBe(2);
    const pending = new FakeOpenAI().always("realtime.calls.create", never()).call("realtime.calls.create", {});
    const winner = await Promise.race([pending.then(() => "settled"), Promise.resolve("pending")]);
    expect(winner).toBe("pending");
  });
});
