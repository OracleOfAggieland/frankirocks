/**
 * The switch fails closed (brief 054 design, correctness property 11, the `demoEnabled` half; R15.1, R15.5).
 * 1,000 runs.
 *   FOR ALL values of FRANKI_DEMO (any string or absent), `demoEnabled` is true exactly when the value is "on", and
 *   `demoStatus` answers `{ enabled }` with that value and nothing else; no other variable changes it.
 * The `runRoute` half (an anonymous token while the switch is off answers 401 AUTH with no read and no write) is part
 * C1's, with the guard change it checks.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEMO_ENV_VAR, demoEnabled, demoStatus } from "./switch";

const RUNS = { numRuns: 1000 };

const value = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.constantFrom("on", "On", "ON", " on", "on ", "on\n", "1", "true", "yes", "", "off"),
  fc.constant(undefined),
);
const others = fc.dictionary(
  fc.string({ maxLength: 12 }).filter((k) => k !== DEMO_ENV_VAR),
  fc.oneof(fc.constant("on"), fc.string({ maxLength: 6 })),
  { maxKeys: 4 },
);

describe("the demo switch", () => {
  it("is on exactly when FRANKI_DEMO is the string on", () => {
    fc.assert(
      fc.property(value, others, (v, rest) => {
        const env = v === undefined ? { ...rest } : { ...rest, [DEMO_ENV_VAR]: v };
        expect(demoEnabled(env)).toBe(v === "on");
        expect(demoStatus(env)).toStrictEqual({ enabled: v === "on" });
      }),
      RUNS,
    );
  });
});
