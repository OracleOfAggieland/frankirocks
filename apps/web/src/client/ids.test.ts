import { ID, validate } from "@franki/core";
import { describe, expect, it } from "vitest";
import { randomId } from "./ids";

describe("randomId", () => {
  it("is a 43-character base64url ID that passes the contracts ID schema", () => {
    for (const fill of [0, 0xfb, 0xff]) {
      const id = randomId((n) => new Uint8Array(n).fill(fill));
      expect(id).toHaveLength(43);
      expect(validate(ID, id).ok).toBe(true);
    }
    expect(randomId()).not.toBe(randomId());
  });
});
