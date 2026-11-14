// Brief 049 part A, rulings 1 and 3: the errand tool in the voice machine's tool list, what a call sends for it, and
// the reply after its result carrying no tools.
import { describe, expect, it } from "vitest";
import { ERRAND_TOOL, ErrandArgs, ToolCall, ToolResult } from "../schema/wire";
import { validate } from "../schema/v";
import { CALL_TOOLS, callToolArgs, isCallToolName } from "./machine";

describe("start_errand on a call", () => {
  it("is offered with the other tools; its only argument is what to look through", () => {
    expect(CALL_TOOLS.map((t) => t.name)).toContain("start_errand");
    expect(isCallToolName("start_errand")).toBe(true);
    expect(ERRAND_TOOL.parameters.required).toEqual(["about"]);
    expect(Object.keys(ERRAND_TOOL.parameters.properties)).toEqual(["about"]);
    expect(ERRAND_TOOL.description).toContain("say one short neutral sentence");
    expect(ERRAND_TOOL.description).toContain("Never guess");
  });

  it("takes a non-empty set of mail and calendar, and nothing else", () => {
    expect(callToolArgs("start_errand", JSON.stringify({ about: ["mail"] }))).toEqual({ args: { about: ["mail"] } });
    expect(validate(ToolCall, { name: "start_errand", args: { about: ["mail", "calendar"] } }).ok).toBe(true);
    expect(validate(ErrandArgs, { about: [] }).ok).toBe(false);
    expect(validate(ErrandArgs, { about: ["mail", "mail"] }).ok).toBe(false);
    expect(validate(ErrandArgs, { about: ["bank"] }).ok).toBe(false);
    expect(validate(ErrandArgs, { about: ["mail"], query: "the lease" }).ok).toBe(false);
  });

  it("answers with a state, the Errand's ID and at most one note", () => {
    expect(validate(ToolResult, { name: "start_errand", state: "started", errandId: null, notes: [] }).ok).toBe(true);
    expect(validate(ToolResult, { name: "start_errand", state: "done", errandId: null, notes: [] }).ok).toBe(false);
  });
});
