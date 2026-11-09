import { describe, expect, it } from "vitest";
import { JUDGE_V1_INSTRUCTIONS, JUDGE_V2_COMPANY_SENTENCE, JUDGE_V2_INSTRUCTIONS } from "../packages/core/src/voice/judge";
import { closeCopies, probeTexts, render, windows } from "./close-copy.mjs";

describe("close-copy check", () => {
  it("renders both sides the same way", () => {
    expect(render("My sister's here.")).toBe(" my sister s here ");
    expect(windows("Delete that, please.")).toEqual(["delete that please"]);
    expect(windows("Hang on, Alex just walked in.")).toEqual(["hang on alex just", "on alex just walked", "alex just walked in"]);
  });

  it("finds a copied probe window and ignores cue words", () => {
    const lines = ["Hang on, Alex just walked in."];
    expect(closeCopies("someone ALEX just walked in today", lines)).toHaveLength(1);
    expect(closeCopies("walked in", lines)).toEqual([]);
  });

  it("reads every probe line", () => {
    expect(probeTexts()).toHaveLength(60);
  });
});

describe("judge_v2 has no probe line in it (R16.2)", () => {
  it("the added sentence holds no 4-word window of any probe line", () => {
    expect(closeCopies(JUDGE_V2_COMPANY_SENTENCE, probeTexts())).toEqual([]);
  });

  it("JUDGE_V2_INSTRUCTIONS adds no copy beyond those already in the contract's judge_v1 literal", () => {
    // judge_v1 (contracts §5) quotes "Don't let me forget", which probe c-forget-5 also says. That text is the
    // contract's, not this spec's choice, and judge_v2 must not add to it.
    const v1 = closeCopies(JUDGE_V1_INSTRUCTIONS, probeTexts());
    expect(v1.map((c) => c.window)).toEqual(["don t let me", "t let me forget"]);
    expect(closeCopies(JUDGE_V2_INSTRUCTIONS, probeTexts())).toEqual(v1);
  });
});
