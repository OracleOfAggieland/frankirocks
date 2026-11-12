import { describe, expect, it } from "vitest";
import { heroOfferParts, heroWindow, isPlainYes } from "./offer";
import { takeoutLateMeetingV1 } from "./takeout";
import { HERO_ORDERS, bankRow, heroInput } from "./testing/hero-fixture";
import type { ReceiptRow } from "./types";
import { testId } from "../testing/samples";

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
  it("a receipt that turns days into nights changes the offer parts (finding 9)", () => {
    const dated = bankRow("o1d", "2026-10-06", null, 3000);
    const input = heroInput({ purchases: [...HERO_ORDERS.slice(1), dated] });
    const days = takeoutLateMeetingV1(input);
    const receipt: ReceiptRow = {
      id: testId("hrc9"),
      rootKey: testId("hrcrk9"),
      receipt: { kind: "receipt", orderKey: null, bankEvidenceId: dated.id, amountCents: 3000, currency: "USD", orderAt: "2026-10-07T00:30:00.000Z", merchantKey: null, match: "exact" },
    };
    const nights = takeoutLateMeetingV1({ ...input, receipts: [receipt] });
    expect([days.associationUnit, nights.associationUnit]).toEqual(["day", "night"]);
    expect(heroOfferParts(nights)).not.toEqual(heroOfferParts(days));
  });

  it("the late count and mostly are in the offer parts (finding 9)", () => {
    const p = takeoutLateMeetingV1(heroInput());
    expect(heroOfferParts({ ...p, lateOrderCount: 3 })).not.toEqual(heroOfferParts(p));
    expect(heroOfferParts({ ...p, mostly: false })).not.toEqual(heroOfferParts(p));
    expect(heroOfferParts({ ...p, receiptIds: [testId("r")] })).not.toEqual(heroOfferParts(p));
  });

  it.each(["No", "Yes, but not tonight", "Maybe", "Wait", "I said yes to Dana", "", "Yes later", "Nah", "Please hold off", "Sure, but I can't this week", "Okay, skip the groceries"])("%s is not", (t) => expect(isPlainYes(t)).toBe(false));
  it("no words are not a yes", () => expect(isPlainYes(null)).toBe(false));
  // Brief 037, finding 4: the reviewer's hedges and deferrals.
  it.each(["Okay, I'll think about it", "Sure, tell me more first", "ok what are they", "Do it tomorrow", "Yeah right", "sure, after I check with Sam", "Yes. Actually, hmm"])("%s is not a yes (finding 4)", (t) =>
    expect(isPlainYes(t)).toBe(false),
  );
  it.each(["Yes, let's do it", "Yes please", "Okay, thanks", "Yep!", "Let's do it."])("%s is a plain yes (finding 4)", (t) => expect(isPlainYes(t)).toBe(true));
});
