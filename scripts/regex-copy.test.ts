import { describe, expect, it } from "vitest";
import { REGEX_TABLE } from "../packages/core/src/intents/regex";
import { closeCopies, probeTexts } from "./close-copy.mjs";

describe("the Regex_Table has no probe line in it (R10.3)", () => {
  it("no 4-word window of any probe line, nor any short probe line, appears in the rendered table", () => {
    const table = REGEX_TABLE.map((r) => r.pattern.source).join("\n");
    expect(closeCopies(table, probeTexts())).toEqual([]);
  });

  it("each row on its own is clean too", () => {
    for (const r of REGEX_TABLE) expect(closeCopies(r.pattern.source, probeTexts())).toEqual([]);
  });
});
