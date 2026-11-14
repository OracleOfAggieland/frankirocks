/** The forget gates (brief 048 stage 5): registered with vitest. The scripts are in gate-forget.ts. */
import { describe, expect, it } from "vitest";
import { scriptSuite } from "../testing/script-runner";
import { FORGET } from "./gate-forget";

for (const s of FORGET) scriptSuite(s);

describe("the forget gates: what is written (spec §13)", () => {
  it("seven scripts, unique ids, each runs a forget through the turn route or waits on what is missing", () => {
    expect(FORGET.map((s) => s.id)).toEqual(["FG01", "FG02", "FG03", "FG04", "FG05", "FG06", "FG07"]);
  });
});
