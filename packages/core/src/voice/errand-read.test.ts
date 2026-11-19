// Owner, Nov 19: `read_errand_result` in the voice machine: offered whenever an errand agent is ready, named in the Head,
// sent with empty arguments, and the reply after its result carries no tools.
import { describe, expect, it } from "vitest";
import { ERRAND_HEAD_LINE, errandStillLookingNote } from "../errands/lines";
import { READ_ERRAND_TOOL, ToolCall, ToolResult } from "../schema/wire";
import { validate } from "../schema/v";
import { callHead, callTools, callToolArgs, isCallToolName, replyCreate } from "./machine";

const names = (st: Parameters<typeof callTools>[0]) => callTools(st).map((t) => t.name);
const ready = { phone: "unavailable", mail: "unavailable", calendar: "ready" } as const;
const none = { phone: "ready", mail: "notConnected", calendar: "expired" } as const;

describe("read_errand_result on a call", () => {
  it("is offered exactly while an errand agent is ready, flat or with specialists", () => {
    expect(names({ errandsReady: true })).toContain("read_errand_result");
    expect(names({ errandsReady: false })).not.toContain("read_errand_result");
    expect(names({ errandsReady: false, specialists: ready })).toContain("read_errand_result");
    expect(names({ errandsReady: true, specialists: none })).not.toContain("read_errand_result");
  });

  it("the Head tells the model to call it when the owner asks whether a look-up came back", () => {
    expect(ERRAND_HEAD_LINE).toContain("read_errand_result");
    expect(callHead("HEAD", { errandsReady: false, specialists: ready })).toContain("call read_errand_result before answering");
    expect(callHead("HEAD", { errandsReady: false, specialists: none })).not.toContain("read_errand_result");
    expect(READ_ERRAND_TOOL.description).toContain("Never say nothing came back without calling it");
  });

  it("takes no arguments and answers a state with at most three notes", () => {
    expect(isCallToolName("read_errand_result")).toBe(true);
    expect(callToolArgs("read_errand_result", "{}")).toEqual({ args: {} });
    expect(validate(ToolCall, { name: "read_errand_result", args: {} }).ok).toBe(true);
    expect(validate(ToolCall, { name: "read_errand_result", args: { about: ["mail"] } }).ok).toBe(false);
    expect(validate(ToolResult, { name: "read_errand_result", state: "found", notes: [] }).ok).toBe(true);
    expect(validate(ToolResult, { name: "read_errand_result", state: "maybe", notes: [] }).ok).toBe(false);
  });

  it("the reply after its result carries no tools", () => {
    const st = { errandsReady: true, specialists: null, taskActivityPolledAt: null, turn: { turnId: "t1", source: "typed", text: "Anything back?" }, session: { sessionId: "s1", generation: 1 }, deck: { head: { text: "HEAD" }, turns: [] } } as never;
    const reply = {
      permit: { stamp: { turnId: "t1" }, noteIds: [], scope: "reply", kind: "slowOrdinary" },
      purpose: "tool",
      notes: [],
      toolCall: { callId: "c1", name: "read_errand_result", arguments: "{}" },
      toolOutput: { name: "read_errand_result", state: "found", notes: [] },
    } as never;
    const ev = replyCreate(st, reply) as unknown as { response: { tools: unknown[] } };
    expect(ev.response.tools).toEqual([]);
  });

  it("start_errand's still-looking note names the look-up and never guesses", () => {
    expect(errandStillLookingNote(["calendar"])).toContain("your calendar is already running");
    expect(errandStillLookingNote(["calendar"])).toContain("never guess");
  });
});
