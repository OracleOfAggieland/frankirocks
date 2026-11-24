/**
 * Token shape (brief 054 design, correctness property 4; R10.4, R10.5). 1,000 runs.
 *   FOR ALL SimTokens t, `readSimToken(simToken(t))` equals t.
 *   FOR ALL strings without the `fsim1~` prefix, `readSimToken` is null.
 *   FOR ALL strings with the prefix that are not `simToken` of some SimToken, `readSimToken` is "malformed".
 *   AND no `simToken` output has the shape of a Plaid access token (`access-`), a Google refresh token (`1//`) or a
 *   Google access token (`ya29.`).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SEED_ZONES } from "../testing/seed";
import { SIM_KINDS, SIM_PREFIX, type SimToken, readSimToken, simToken } from "./token";

const RUNS = { numRuns: 1000 };
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-".split("");

const fixtureId = fc.array(fc.constantFrom(...ID_CHARS), { minLength: 43, maxLength: 43 }).map((a) => a.join(""));
const zone = fc.constantFrom(...SEED_ZONES, "UTC", "Etc/GMT+5", "America/Argentina/ComodRivadavia", "America/Port-au-Prince");
const simTok: fc.Arbitrary<SimToken> = fc.record({
  kind: fc.constantFrom(...SIM_KINDS),
  fixtureId,
  worldStart: fc.integer({ min: 0, max: 999_999_999_999_999 }),
  zone,
});

/** Live-shaped tokens and anything else that does not start with the marker. */
const unmarked = fc.oneof(
  fc.string({ maxLength: 200 }).filter((s) => !s.startsWith(SIM_PREFIX)),
  fc.string({ maxLength: 80 }).map((s) => `access-sandbox-${s}`),
  fc.string({ maxLength: 80 }).map((s) => `1//${s}`),
  fc.string({ maxLength: 80 }).map((s) => `ya29.${s}`),
  // Near misses of the marker: another version, another case, no separator.
  fc.constantFrom("fsim2~bank~x", "FSIM1~bank~x", "fsim1", "fsim1-bank", " fsim1~bank"),
);

/** One small damage to a valid token's text. The result is still marked, and almost never canonical. */
const damaged = fc
  .tuple(
    simTok,
    fc.oneof(
      fc.record({ op: fc.constant("cut" as const), n: fc.nat(200) }),
      fc.record({ op: fc.constant("append" as const), s: fc.string({ minLength: 1, maxLength: 4 }) }),
      fc.record({ op: fc.constant("insert" as const), n: fc.nat(200), s: fc.string({ minLength: 1, maxLength: 3 }) }),
      fc.record({ op: fc.constant("lead0" as const) }),
      fc.record({ op: fc.constant("kind" as const), s: fc.constantFrom("Bank", "token", "", "refresh2") }),
    ),
  )
  .map(([t, d]) => {
    const good = simToken(t);
    switch (d.op) {
      case "cut":
        return good.slice(0, SIM_PREFIX.length + (d.n % (good.length - SIM_PREFIX.length)));
      case "append":
        return good + d.s;
      case "insert": {
        const at = SIM_PREFIX.length + (d.n % (good.length - SIM_PREFIX.length + 1));
        return good.slice(0, at) + d.s + good.slice(at);
      }
      case "lead0":
        return `${SIM_PREFIX}${t.kind}~${t.fixtureId}~0${t.worldStart}~${t.zone}`;
      case "kind":
        return `${SIM_PREFIX}${d.s}~${t.fixtureId}~${t.worldStart}~${t.zone}`;
    }
  });

describe("simulator tokens: one exact shape", () => {
  it("reads back every token it writes", () => {
    fc.assert(
      fc.property(simTok, (t) => {
        expect(readSimToken(simToken(t))).toEqual(t);
      }),
      RUNS,
    );
  });

  it("reads a string without the marker as no simulator token", () => {
    fc.assert(
      fc.property(unmarked, (s) => {
        expect(readSimToken(s)).toBeNull();
      }),
      RUNS,
    );
  });

  it("reads a marked string that is not a written token as malformed", () => {
    fc.assert(
      fc.property(fc.oneof(damaged, fc.string({ maxLength: 160 }).map((s) => SIM_PREFIX + s)), (s) => {
        const r = readSimToken(s);
        // The one way a marked string reads as a token is by being exactly what `simToken` writes for it.
        if (r === null) throw new Error("a marked string read as unmarked");
        if (r !== "malformed") expect(simToken(r)).toBe(s);
      }),
      RUNS,
    );
  });

  it("never writes anything shaped like a live Plaid or Google token", () => {
    fc.assert(
      fc.property(simTok, (t) => {
        const s = simToken(t);
        expect(s.startsWith(SIM_PREFIX)).toBe(true);
        expect(s.startsWith("access-")).toBe(false);
        expect(s.startsWith("1//")).toBe(false);
        expect(s.startsWith("ya29.")).toBe(false);
        expect(/^[!-~]+$/.test(s)).toBe(true);
      }),
      RUNS,
    );
  });
});
