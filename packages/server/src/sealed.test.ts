// Brief 049 ruling 17: the sealing helper is generic, and the bank's tokens sealed before the change still open.
import { describe, expect, it } from "vitest";
import { openToken, sealToken } from "./bank/seal";
import { ConfigError } from "./config/env";
import { SealError, seal, sealKeysFrom, unseal } from "./sealed";

const keys = { 1: Buffer.alloc(32, 7) };
/** Sealed by the bank's own `sealToken` as it was before brief 049 (git HEAD 23016fe), with a fixed IV. */
const BEFORE = { v: 1 as const, iv: "AwMDAwMDAwMDAwMD", body: "RJ3AZilbczEbLic-hC_SbY9faBeqmPIRlc1mGqPybdompg" };

describe("sealed values (brief 049 ruling 17)", () => {
  it("opens a bank token sealed before the helper was made generic", () => {
    expect(openToken(keys, "owner-1", "c0nnector", BEFORE)).toBe("access-sandbox-abc");
    expect(sealToken(keys, "owner-1", "c0nnector", "access-sandbox-abc", Buffer.alloc(12, 3))).toEqual(BEFORE);
  });

  it("binds the label: a value sealed under one label opens under no other", () => {
    const g = seal("franki-google-token", keys, "owner-1", "c0nnector", "1//refresh");
    expect(unseal("franki-google-token", keys, "owner-1", "c0nnector", g)).toBe("1//refresh");
    expect(() => unseal("franki-bank-token", keys, "owner-1", "c0nnector", g)).toThrow(SealError);
    expect(() => unseal("franki-google-verifier", keys, "owner-1", "c0nnector", g)).toThrow(SealError);
    expect(() => openToken(keys, "owner-1", "c0nnector", g)).toThrow(SealError);
  });

  it("binds the owner and the record", () => {
    const g = seal("franki-google-token", keys, "owner-1", "c0nnector", "1//refresh");
    expect(() => unseal("franki-google-token", keys, "owner-2", "c0nnector", g)).toThrow(SealError);
    expect(() => unseal("franki-google-token", keys, "owner-1", "other", g)).toThrow(SealError);
  });

  it("fails with no detail", () => {
    try {
      unseal("franki-google-token", keys, "owner-1", "c0nnector", { v: 1, iv: "AwMDAwMDAwMDAwMD", body: "AAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SealError);
      expect((error as Error).message).toBe("sealed value did not open");
    }
  });

  it("reads the key by name, refusing anything but 32 bytes in base64", () => {
    expect(sealKeysFrom({ K: Buffer.alloc(32, 1).toString("base64") }, "K")[1].length).toBe(32);
    expect(() => sealKeysFrom({}, "K")).toThrow(ConfigError);
    expect(() => sealKeysFrom({ K: Buffer.alloc(16, 1).toString("base64") }, "K")).toThrow(ConfigError);
  });
});
