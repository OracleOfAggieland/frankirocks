// Feature: the review of what reaches the wire (brief 045, part V), property 2, the Deck's half: third-party text
// never reaches the model. A Turn of class T (pasted, or typed text classified T) is never a SafeTurn, so no Deck's
// `turns` carries its text into a call or a typed reply, whatever its role, text or Sensitivity. A U Turn with a
// sayable Sensitivity still is one. The machine's half is `core/src/voice/third-party-never-to-model.property.test.ts`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildSlice } from "@franki/core";
import { sampleEvidence, sampleTurn, testId } from "@franki/core/testing";
import { createHasher } from "./crypto";
import { FAKE_HMAC_KEY } from "./testing/fakes";
import { safeTurn } from "./turns";

const testHasher = createHasher(FAKE_HMAC_KEY);

describe("Property 2 (brief 045), the Deck's half: a T Turn is never a SafeTurn", () => {
  it("class T is left out; class U at S0 or S1 is kept", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 120 }), fc.constantFrom("U", "T"), fc.constantFrom("S0", "S1"), fc.constantFrom("user", "assistant"), (text, cls, sens, role) => {
        const eid = testId("ev");
        const slice = buildSlice({ eid, fieldPath: "text", fieldText: text, start: 0, end: text.length, class: cls === "T" ? "T" : "U", sens }, testHasher);
        const turn = sampleTurn({ text, sourceClass: cls as never, role: role as never });
        const got = safeTurn(testId("t1") as never, turn, sampleEvidence({ fieldSlices: [slice] }), eid as never, testHasher);
        if (cls === "T") expect(got).toBeNull();
        else expect(got?.text).toBe(text.slice(0, 2048));
      }),
      { numRuns: 1_000 },
    );
  });
});
