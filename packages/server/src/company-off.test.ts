import type { Turn } from "@franki/core";
import { describe, expect, it } from "vitest";
import { failedParseIsOrdinary, ownerSpeakerCertain } from "./company-off";

const on = { FRANKI_COMPANY_MODE: "on" };
const off = {};
const voice: Pick<Turn, "itemIds" | "judge" | "sourceClass" | "final"> = { itemIds: ["item_1"], judge: null, sourceClass: "U", final: true };

describe("owner, Nov 19: company-off rulings", () => {
  it("a failed slow parse counts as ordinary only with company mode off", () => {
    expect(failedParseIsOrdinary(off)).toBe(true);
    expect(failedParseIsOrdinary({ FRANKI_COMPANY_MODE: "off" })).toBe(true);
    expect(failedParseIsOrdinary(on)).toBe(false);
  });

  it("a final class-U voice line is a certain speaker without judge O, with company mode off", () => {
    expect(ownerSpeakerCertain(voice, off)).toBe(true);
    expect(ownerSpeakerCertain({ ...voice, judge: "U" }, off)).toBe(true);
    expect(ownerSpeakerCertain(voice, on)).toBe(false);
  });

  it("typed lines and judge O are certain either way; other classes and non-final lines need judge O", () => {
    for (const env of [on, off]) {
      expect(ownerSpeakerCertain({ ...voice, itemIds: [] }, env)).toBe(true);
      expect(ownerSpeakerCertain({ ...voice, judge: "O" }, env)).toBe(true);
      expect(ownerSpeakerCertain({ ...voice, sourceClass: "C" }, env)).toBe(false);
      expect(ownerSpeakerCertain({ ...voice, sourceClass: "T" }, env)).toBe(false);
      expect(ownerSpeakerCertain({ ...voice, final: false }, env)).toBe(false);
    }
  });
});
