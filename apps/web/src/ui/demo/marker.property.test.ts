/**
 * The marker never replaces a real user (brief 054 design, correctness property 20; R2.6, R2.7, R2.8).
 * 1,000 runs.
 *   FOR ALL hashes, auth states and switch answers: `markerAction` is `signInAnonymously` only when the hash is
 *   exactly `#demo`, nobody is signed in and the switch said on; `offerSwitch` only when a non-anonymous user is
 *   signed in (with the marker and the switch on); and `none` or `clear` otherwise. With no marker it is `none`.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type MarkerAuth, markerAction } from "./marker";

const RUNS = { numRuns: 1000 };

const hash = fc.oneof(fc.constant("#demo"), fc.constantFrom("", "#", "#Demo", "#demo ", "#demo2", "demo", "#xdemo"), fc.string({ maxLength: 8 }), fc.string({ maxLength: 6 }).map((s) => `#${s}`));
const auth = fc.constantFrom<MarkerAuth>("loading", "signedOut", "signedInReal", "signedInDemo");
const enabled = fc.constantFrom<boolean | null>(true, false, null);

describe("Property 20: the marker never replaces a real user", () => {
  it("signs in anonymously only when signed out, and only offers a switch to a real user", () => {
    fc.assert(
      fc.property(hash, auth, enabled, (h, a, on) => {
        const action = markerAction({ hash: h, auth: a, enabled: on });
        const marked = h === "#demo";
        if (action === "signInAnonymously") expect(marked && a === "signedOut" && on === true).toBe(true);
        if (action === "offerSwitch") expect(marked && a === "signedInReal" && on === true).toBe(true);
        // A real user is never signed in over.
        if (a === "signedInReal") expect(action).not.toBe("signInAnonymously");
        if (!marked) expect(action).toBe("none");
        // Until both the auth state and the switch have answered, nothing happens.
        if (a === "loading" || on === null) expect(action).toBe("none");
        expect(["none", "clear", "signInAnonymously", "offerSwitch"]).toContain(action);
        // The table, row by row.
        if (marked && a !== "loading" && on === false) expect(action).toBe("clear");
        if (marked && on === true && a === "signedOut") expect(action).toBe("signInAnonymously");
        if (marked && on === true && a === "signedInDemo") expect(action).toBe("clear");
        if (marked && on === true && a === "signedInReal") expect(action).toBe("offerSwitch");
      }),
      RUNS,
    );
  });
});
