import { describe, expect, it } from "vitest";
import { ClaimsOutput, PrivateReadOwnOutput, TOPICS, claimsSpans, topicDomain } from "./claims";
import { DOMAINS } from "./schema/primitives";
import { validate } from "./schema/v";
import { testId } from "./testing";

const span = (quote: string) => ({ eid: testId("ev"), fieldPath: "body" as const, start: 0, end: quote.length, quote });
const none = { kind: "none", spoken: null, appliesTo: "occurrence", anchorHint: null };
const empty = { version: "ClaimsV1", logistics: [], senderPromises: [], claimsAboutUser: [], topicSignals: [], directiveCount: 0, continuation: null };

describe("source reader outputs (contracts §5)", () => {
  it("ClaimsV1 is closed: an extra field or a rule-like field fails", () => {
    expect(validate(ClaimsOutput, empty).ok).toBe(true);
    expect(validate(ClaimsOutput, { ...empty, rules: [] }).ok).toBe(false);
    expect(validate(ClaimsOutput, { ...empty, directiveCount: 101 }).ok).toBe(false);
  });

  it("claimsSpans lists every quoted span in output order", () => {
    const out = {
      ...empty,
      logistics: [{ type: "reschedule", when: none, where: null, participants: [], spans: [span("moved")] }],
      topicSignals: [{ topic: "work", subjectName: null, spans: [span("role")] }],
    };
    const v = validate(ClaimsOutput, out);
    expect(v.ok).toBe(true);
    if (v.ok) expect(claimsSpans(v.value).map((s) => s.quote)).toEqual(["moved", "role"]);
  });

  it("a private guess needs at least one supporting span", () => {
    const guess = { topic: "money", claim: "money may be tight", support: [], counter: [], contextIds: [], subtract: [] };
    expect(validate(PrivateReadOwnOutput, { version: "PrivateReadOwnV1", missed: [], hypotheses: [guess], continuation: null }).ok).toBe(false);
    expect(validate(PrivateReadOwnOutput, { version: "PrivateReadOwnV1", missed: [], hypotheses: [{ ...guess, support: [span("bill")] }], continuation: null }).ok).toBe(true);
  });

  it("every reader Topic maps onto a hypothesis Domain", () => {
    for (const t of TOPICS) expect(DOMAINS).toContain(topicDomain(t));
    expect(topicDomain("family")).toBe("relationship");
    expect(topicDomain("other_secret")).toBe("other");
  });
});
