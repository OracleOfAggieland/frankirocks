import { describe, expect, it } from "vitest";
import { heroOfferParts, heroWindow, isPlainYes } from "./offer";
import { takeoutLateMeetingV1 } from "./takeout";
import { heroInput } from "./testing/hero-fixture";

describe("the hero offer", () => {
  it("the window is the 21 dates ending yesterday", () => {
    expect(heroWindow("2026-10-26", "America/Chicago", "USD")).toEqual({ fromCivil: "2026-10-05", toCivil: "2026-10-25", zone: "America/Chicago", currency: "USD" });
  });

  it("the same rows give the same offer parts; another row changes them", () => {
    const a = heroOfferParts(takeoutLateMeetingV1(heroInput()));
    expect(heroOfferParts(takeoutLateMeetingV1(heroInput()))).toEqual(a);
    const fewer = heroInput();
    expect(heroOfferParts(takeoutLateMeetingV1({ ...fewer, purchases: fewer.purchases.slice(1) }))).not.toEqual(a);
  });

  it.each(["Yes", "Yes.", "Yeah, let's do it", "Sure", "OK please", "Sounds good"])("%s is a plain yes", (t) => expect(isPlainYes(t)).toBe(true));
  it.each(["No", "Yes, but not tonight", "Maybe", "Wait", "I said yes to Dana", "", "Yes later", "Nah"])("%s is not", (t) => expect(isPlainYes(t)).toBe(false));
  it("no words are not a yes", () => expect(isPlainYes(null)).toBe(false));
});
