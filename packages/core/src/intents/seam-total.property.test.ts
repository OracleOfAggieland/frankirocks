// Feature: voice-control, Property 8: The seam is total and closed (R20.1.8; R8.3–R8.12, R10.2, R12).
// For every input the Server_Rule returns exactly one Permit kind or a hold; an S1+ note only on a turn the judge
// marked O (or a typed line), in a private audience with no parse gap; crisis replies carry no notes, no tools and
// no fixed line; a missing transcript or a failed parse gets recoveryOnly, cutting a playing reply only on a regex
// match; and a regex match never changes the outcome of a parse that succeeded.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type RuleInput, serverRule } from "../admission";
import { PERMIT_KINDS } from "../schema/records";
import { allRuleInputs, arbRuleInput } from "./testing/arb-rule-input";

function check(i: RuleInput): void {
  const o = serverRule(i);
  expect(["permit", "hold"]).toContain(o.kind);
  if (o.kind === "permit") {
    expect(PERMIT_KINDS).toContain(o.permit);
    if (o.notes === "all") {
      expect(["O", "typed"]).toContain(i.judge);
      expect(i.audience).toBe("private");
      expect(i.parseGap).toBe(false);
    }
    if (o.permit === "recoveryOnly") expect(o.notes).toBe("none");
  }
  if ((i.source === "asr" || i.source === "typed") && !i.narrowedHere) {
    if (i.transcript !== "final") expect(o).toMatchObject({ kind: "permit", permit: "recoveryOnly", cut: false });
    else if (i.parse.kind === "failed" || i.parse.kind === "none") expect(o).toMatchObject({ kind: "permit", permit: "recoveryOnly", cut: i.regexMatch });
    else if (i.parse.kind === "hit" && i.parse.candidates.includes("crisis")) expect(o).toMatchObject({ kind: "permit", scope: "ack", notes: "none", line: null });
  }
  if (i.parse.kind !== "failed" && i.parse.kind !== "none") expect(serverRule({ ...i, regexMatch: !i.regexMatch })).toEqual(o);
}

describe("Property 8: the seam is total and closed", () => {
  it("holds for generated inputs", () => {
    fc.assert(fc.property(arbRuleInput, (i) => check(i)), { numRuns: 1_000 });
  });

  it("holds for every combination of the enum-only part", () => {
    for (const i of allRuleInputs()) check(i);
  });
});
