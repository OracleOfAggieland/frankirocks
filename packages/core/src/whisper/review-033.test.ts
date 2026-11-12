/** The review of the whisper builder (brief 033): each finding on the reviewer's own inputs. */
import { describe, expect, it } from "vitest";
import type { GateResult } from "../gate/types";
import { testId } from "../testing/samples";
import { buildWhisper } from "./build";

const OPS = Date.parse("2026-11-12T17:00:00.000Z");
const at = { opsNow: OPS, trigger: "unprompted" as const };
const say = (o: Partial<GateResult> = {}): GateResult => ({ verdict: "say", form: "item", render: "free", carveOut: null, mustSay: null, fixedLine: null, reasons: ["ok"], ...o });
const note = (tokens: string[]) => ({ noteId: testId("n1"), momentId: null, sens: "S0" as const, rootKeys: [], dependsOn: [], tokens });

describe("whisper tokens are carried as given", () => {
  it("refuses a token with space around it instead of trimming it (the committed adds-nothing property, seed -961430087)", () => {
    expect(buildWhisper(note(["! "]), say(), "item", at)).toBeNull();
    expect(buildWhisper(note([" Pip"]), say(), "item", at)).toBeNull();
    expect(buildWhisper(note(["Pip"]), say(), "item", at)?.tokens).toEqual(["Pip"]);
  });
});
