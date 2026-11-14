import { describe, expect, it } from "vitest";
import { RECOVERY_LINE as FROM_ADMISSION } from "../admission";
import { W } from "../schema/wire";
import { validate } from "../schema/v";
import { testId } from "../testing/samples";
import {
  ALONE_LINE,
  ASK_ALLERGIES_LINE,
  COMPANY_LINE,
  FIXED_LINES,
  FORGET_ACK_TEXTS,
  FORGET_ASK_LINE,
  GONE_EXCEPT_RULE_LINE,
  GONE_LINE,
  RECOVERY_LINE,
  RETELL_LINE,
  ackNote,
  forgetAckText,
  isFixedLine,
  sayExactly,
} from "./lines";
import { SEMANTIC_VAD } from "./vad";

describe("Fixed_Lines", () => {
  it("are the exact texts of brief 011", () => {
    expect(RECOVERY_LINE).toBe("Sorry, say that again?");
    expect(COMPANY_LINE).toBe("Got it. I'll keep things general for now.");
    expect(ALONE_LINE).toBe("Okay, just us again.");
    expect(FROM_ADMISSION).toBe(RECOVERY_LINE);
  });

  it("are the exact texts of brief 048 ruling 7, and the forget-not-yet line is gone", () => {
    expect(GONE_LINE).toBe("Gone.");
    expect(GONE_EXCEPT_RULE_LINE).toBe("Gone, except one safety rule. It's on your screen.");
    expect(ASK_ALLERGIES_LINE).toBe("Any allergies I should know?");
    expect(RETELL_LINE).toBe("A few things that went with it are gone too. Tell me again anytime.");
    expect(FORGET_ASK_LINE).toBe("I'm not sure which one you mean. Can you say a bit more?");
    expect(Object.values(FIXED_LINES)).not.toContain("I can't forget things yet.");
  });

  it("make each acknowledgment from the job's ack, in order", () => {
    expect(forgetAckText("gone", false)).toBe("Gone.");
    expect(forgetAckText("gone", true)).toBe("Gone. Any allergies I should know?");
    expect(forgetAckText("goneExceptRule", false)).toBe("Gone, except one safety rule. It's on your screen.");
    expect(forgetAckText("goneExceptRule", true)).toBe("Gone, except one safety rule. It's on your screen. Any allergies I should know?");
    expect(forgetAckText("offerRetell", false)).toBe(`Gone. ${RETELL_LINE}`);
    expect(forgetAckText("offerRetell", true)).toBe(`Gone. ${RETELL_LINE} Any allergies I should know?`);
    expect(forgetAckText("ask", true)).toBe(FORGET_ASK_LINE);
    expect(FORGET_ACK_TEXTS).toHaveLength(7);
    for (const t of FORGET_ACK_TEXTS) expect(isFixedLine(t)).toBe(true);
  });

  it("travel as an S0 ack note that validates", () => {
    const n = ackNote(GONE_LINE, testId("note"), "2026-11-10T12:00:10.000Z");
    expect(validate(W, n).ok).toBe(true);
    expect(n).toMatchObject({ kind: "ack", sens: "S0", text: GONE_LINE, unprompted: false });
    expect(isFixedLine(n.text)).toBe(true);
    expect(isFixedLine("Gone, I think.")).toBe(false);
    expect(isFixedLine("I can't forget things yet.")).toBe(false);
    expect(sayExactly(ALONE_LINE)).toBe('Say exactly this and nothing else: "Okay, just us again."');
  });
});

describe("VAD settings", () => {
  it("stay semantic_vad with app-created responses", () => {
    expect(SEMANTIC_VAD).toEqual({ type: "semantic_vad", eagerness: "auto", create_response: false, interrupt_response: false });
  });
});
