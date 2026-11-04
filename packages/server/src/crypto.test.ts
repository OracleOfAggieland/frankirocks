import { describe, expect, it } from "vitest";
import { ConfigError } from "./config/env";
import { createHasher, hasherFromEnv, hmacId, sha256Hex } from "./crypto";

/** Fixed fake key for tests (design contract question 1). Not a secret. */
const FAKE_KEY = "test-only-franki-id-hmac-key-0000000000000";

describe("crypto", () => {
  it("HMAC ID is 43 chars with the fixed fake key", () => {
    const id = hmacId(FAKE_KEY, ["session", "owner-1", "req-1"]);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hmacId(FAKE_KEY, ["session", "owner-1", "req-1"])).toBe(id);
    expect(hmacId(FAKE_KEY, ["session", "owner-1", "req-2"])).not.toBe(id);
    expect(hmacId(`${FAKE_KEY}x`, ["session", "owner-1", "req-1"])).not.toBe(id);
  });
  it("ID input is canonical: key order does not change the ID", () => {
    expect(hmacId(FAKE_KEY, { a: 1, b: 2 })).toBe(hmacId(FAKE_KEY, { b: 2, a: 1 }));
  });
  it("sha256Hex matches the known vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(createHasher(FAKE_KEY).sha256(new TextEncoder().encode("abc"))).toBe(sha256Hex("abc"));
  });
  it("hasherFromEnv names the missing variable without a value", () => {
    expect(() => hasherFromEnv({})).toThrow(ConfigError);
    const error = (() => {
      try {
        hasherFromEnv({ FRANKI_ID_HMAC_KEY: "  " });
        return null;
      } catch (e) {
        return e as ConfigError;
      }
    })();
    expect(error?.variable).toBe("FRANKI_ID_HMAC_KEY");
    expect(error?.message).toBe("CONFIG: FRANKI_ID_HMAC_KEY is not set");
  });
});
