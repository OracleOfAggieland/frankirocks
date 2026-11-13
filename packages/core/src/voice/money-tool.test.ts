// Brief 046 part C: the money read in the voice machine's tool list, and what a call sends for it.
import { describe, expect, it } from "vitest";
import { MONEY_TOOL, MoneyArgs, ToolCall } from "../schema/wire";
import { validate } from "../schema/v";
import { CALL_TOOLS, callToolArgs, isCallToolName } from "./machine";

describe("read_money on a call", () => {
  it("is offered with the other tools, and its description says both rules", () => {
    expect(CALL_TOOLS.map((t) => t.name)).toContain("read_money");
    expect(isCallToolName("read_money")).toBe(true);
    expect(MONEY_TOOL.description).toContain("Use it only when the user asks about their own spending.");
    expect(MONEY_TOOL.description).toContain("Never state an amount that the tool did not return");
    expect(MONEY_TOOL.parameters.required).toEqual(["period", "group", "merchant"]);
  });

  it("sends the model's arguments as parsed, and the route's closed shape takes only the question's shape", () => {
    const args = { period: "last_week", group: "groceries", merchant: null };
    expect(callToolArgs("read_money", JSON.stringify(args))).toEqual({ args });
    expect(callToolArgs("read_money", "{")).toBeNull();
    expect(validate(ToolCall, { name: "read_money", args }).ok).toBe(true);
    expect(validate(MoneyArgs, { ...args, amountCents: 100 }).ok).toBe(false);
    expect(validate(MoneyArgs, { ...args, period: "since 2020" }).ok).toBe(false);
  });
});
