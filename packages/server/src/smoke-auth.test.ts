import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isSmokeAuthorized } from "./smoke-auth";

const token = fc.string({ minLength: 1, maxLength: 64 });

describe("isSmokeAuthorized", () => {
  it("accepts a bearer header only when it carries exactly the token", () => {
    fc.assert(
      fc.property(token, fc.string({ maxLength: 64 }), (expected, given) => {
        expect(isSmokeAuthorized(`Bearer ${given}`, expected)).toBe(given === expected);
      }),
    );
  });

  it("rejects headers without the Bearer prefix", () => {
    fc.assert(
      fc.property(token, fc.string({ maxLength: 80 }), (expected, header) => {
        fc.pre(!header.startsWith("Bearer "));
        expect(isSmokeAuthorized(header, expected)).toBe(false);
      }),
    );
  });

  it("rejects everything when no token is configured", () => {
    fc.assert(
      fc.property(fc.string(), (given) => {
        expect(isSmokeAuthorized(`Bearer ${given}`, undefined)).toBe(false);
        expect(isSmokeAuthorized(`Bearer ${given}`, "")).toBe(false);
      }),
    );
  });
});
