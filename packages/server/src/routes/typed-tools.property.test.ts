// Kiroween Demo, property 17 (R14.1): the typed turn's one tool flag is split into a phone flag and a money flag. For
// any `{ phone, money }` and any `boolean`, `typedReplyRequest(...).tools` holds `make_phone_call` and
// `read_phone_result` exactly when the phone is allowed and `read_money` exactly when money is, in today's order;
// `true` gives today's list and `false` none; and nothing else in the request changes.
import { MONEY_TOOL, PHONE_TOOL, READ_PHONE_TOOL, type SafeTurn } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type TypedTools, typedReplyRequest } from "./typed-reply";

const TODAY = [{ ...PHONE_TOOL, strict: true }, { ...MONEY_TOOL, strict: true }, { ...READ_PHONE_TOOL, strict: true }];
const TURNS: SafeTurn[] = [];
const names = (allow: boolean | TypedTools) => typedReplyRequest("model", "HEAD", TURNS, "hello", allow).tools.map((t) => t.name);

describe("typed tools split (Kiroween Demo property 17)", () => {
  it("property: each flag offers exactly its tools, in today's order", () => {
    fc.assert(
      fc.property(fc.oneof(fc.boolean(), fc.record({ phone: fc.boolean(), money: fc.boolean() })), fc.string({ maxLength: 40 }), (allow, text) => {
        const flags: TypedTools = typeof allow === "boolean" ? { phone: allow, money: allow } : allow;
        const req = typedReplyRequest("model", "HEAD", TURNS, text, allow);
        const got = req.tools.map((t) => t.name);
        expect(got.includes("make_phone_call")).toBe(flags.phone);
        expect(got.includes("read_phone_result")).toBe(flags.phone);
        expect(got.includes("read_money")).toBe(flags.money);
        // Today's order, today's tool objects: a subsequence of the full list.
        expect(req.tools).toEqual(TODAY.filter((t) => (t.name === "read_money" ? flags.money : flags.phone)));
        // Nothing else moves with the flags.
        const { tools: _, ...rest } = req;
        const { tools: __, ...base } = typedReplyRequest("model", "HEAD", TURNS, text, false);
        expect(rest).toEqual(base);
      }),
      { numRuns: 1_000 },
    );
  });

  it("true is today's list, false none, and a demo visit's typed turn keeps read_money only", () => {
    expect(typedReplyRequest("model", "HEAD", TURNS, "hello", true).tools).toEqual(TODAY);
    expect(names(false)).toEqual([]);
    expect(names({ phone: false, money: true })).toEqual(["read_money"]);
    expect(names({ phone: true, money: true })).toEqual(["make_phone_call", "read_money", "read_phone_result"]);
  });
});
