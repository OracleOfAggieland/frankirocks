/** The review of the Gate's audience seam (brief 033 finding 13). */
import { tsFromMs } from "@franki/core";
import { sampleSession, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { gateAudience } from "./audience";

const OPS = Date.parse("2026-11-12T17:00:00.000Z");

describe("finding 13: the Gate's audience is unknown on a parse gap or an unreadable lease", () => {
  it("reads a parse gap as unknown", () => {
    const s = sampleSession({ audience: "private", committedParseSeq: 1, lastClientSeq: 2 });
    expect(gateAudience(s, OPS).audience).toBe("unknown");
    expect(gateAudience({ ...s, committedParseSeq: 2 }, OPS).audience).toBe("private");
  });

  it("reads a lease whose time is not a time as unknown", () => {
    const s = sampleSession({ audience: "private", parseLease: { clientSeq: 1, token: testId("tok"), until: "not a time" } });
    expect(gateAudience(s, OPS).audience).toBe("unknown");
    expect(gateAudience(sampleSession({ audience: "private", parseLease: { clientSeq: 1, token: testId("tok"), until: tsFromMs(OPS - 1) } }), OPS).audience).toBe("private");
  });
});
