import { describe, expect, it } from "vitest";
import { RECOVERY_LINE as FROM_ADMISSION } from "../admission";
import { W } from "../schema/wire";
import { validate } from "../schema/v";
import { testId } from "../testing/samples";
import { ALONE_LINE, COMPANY_LINE, FORGET_NOT_YET, RECOVERY_LINE, ackNote, isFixedLine, sayExactly } from "./lines";
import { SEMANTIC_VAD } from "./vad";

describe("Fixed_Lines", () => {
  it("are the exact texts of brief 011", () => {
    expect(RECOVERY_LINE).toBe("Sorry, say that again?");
    expect(FORGET_NOT_YET).toBe("I can't forget things yet.");
    expect(COMPANY_LINE).toBe("Got it. I'll keep things general for now.");
    expect(ALONE_LINE).toBe("Okay, just us again.");
    expect(FROM_ADMISSION).toBe(RECOVERY_LINE);
  });

  it("travel as an S0 ack note that validates", () => {
    const n = ackNote(FORGET_NOT_YET, testId("note"), "2026-11-10T12:00:10.000Z");
    expect(validate(W, n).ok).toBe(true);
    expect(n).toMatchObject({ kind: "ack", sens: "S0", text: FORGET_NOT_YET, unprompted: false });
    expect(isFixedLine(n.text)).toBe(true);
    expect(isFixedLine("Gone.")).toBe(false);
    expect(sayExactly(ALONE_LINE)).toBe('Say exactly this and nothing else: "Okay, just us again."');
  });
});

describe("VAD settings", () => {
  it("stay semantic_vad with app-created responses", () => {
    expect(SEMANTIC_VAD).toEqual({ type: "semantic_vad", eagerness: "auto", create_response: false, interrupt_response: false });
  });
});
