import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CALL_ERRORS } from "../components/CallScreen";
import { type AnnounceView, announcement } from "./announce";
import { AVATAR_LABELS, CALL_STATUS } from "./copy";

// Feature: lab-ui-foundation, Property 14: One coalesced announcement
describe("Property 14: One coalesced announcement", () => {
  const arbView: fc.Arbitrary<AnnounceView> = fc.record({
    avatar: fc.constantFrom(...Object.values(AVATAR_LABELS)),
    call: fc.constantFrom(...Object.values(CALL_STATUS)),
    error: fc.constantFrom(null, ...Object.values(CALL_ERRORS)),
  });
  const occurrences = (text: string, part: string) => text.split(part).length - 1;

  it("is null exactly when nothing changed, else names each changed part once, in order", () => {
    fc.assert(
      fc.property(arbView, arbView, fc.boolean(), (prev, next0, same) => {
        const next = same ? { ...prev } : next0;
        const out = announcement(prev, next);
        const changed = [
          next.avatar !== prev.avatar ? next.avatar : null,
          next.call !== prev.call ? next.call : null,
          next.error !== prev.error && next.error !== null ? next.error : null,
        ].filter((p): p is string => p !== null);
        if (changed.length === 0) {
          expect(out).toBeNull();
          return;
        }
        expect(out).not.toBeNull();
        let from = 0;
        for (const part of changed) {
          const text = part.replace(/\.$/, "");
          expect(occurrences(out!, text)).toBe(1);
          const at = out!.indexOf(text);
          expect(at).toBeGreaterThanOrEqual(from);
          from = at + text.length;
        }
        if (next.avatar === prev.avatar) expect(out).not.toContain(next.avatar);
        if (next.call === prev.call) expect(out).not.toContain(next.call);
        if (next.error === prev.error && next.error !== null) expect(out).not.toContain(next.error.replace(/\.$/, ""));
      }),
      { numRuns: 300 },
    );
  });
});
