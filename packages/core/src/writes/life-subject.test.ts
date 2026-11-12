// Brief 043, finding 1: the closed lists that decide whose noun phrase a life change names.
import { describe, expect, it } from "vitest";
import { OTHER_OWNERS, OWNER_POSSESSIVES, PHRASE_LINKS, PHRASE_MODIFIERS, lifeMentionOwned, occurrences, ownerWordsSettle, phraseOwner } from "./life-subject";
import { DAD, KNOWN, ENTITIES, TURN_AT, TURN_EID, buildEvidence, spanAt, turnEvidenceOf } from "./testing/arb-writes";

const owner = (text: string, phrase: string, from = 0) => {
  const i = text.indexOf(phrase, from);
  return phraseOwner(text, i, i + phrase.length);
};

describe("the closed lists", () => {
  it("hold what they say", () => {
    expect([...OWNER_POSSESSIVES]).toEqual(["my", "our"]);
    for (const w of ["his", "her", "their", "your", "a", "the"]) expect(OTHER_OWNERS.has(w)).toBe(true);
    expect(OTHER_OWNERS.has("my")).toBe(false);
    expect(PHRASE_MODIFIERS.has("late")).toBe(true);
    expect([...PHRASE_LINKS]).toEqual(["of"]);
  });
});

describe("phraseOwner", () => {
  it("the speaker's own: my, our, a bare name or relation word, read through modifiers and apposition", () => {
    expect(owner("My mom passed away.", "mom")).toBe("owner");
    expect(owner("My mom passed away.", "My mom")).toBe("owner");
    expect(owner("Our dog died.", "dog")).toBe("owner");
    expect(owner("Mom passed away.", "Mom")).toBe("owner");
    expect(owner("Sam passed away.", "Sam")).toBe("owner");
    expect(owner("My late dad was ill.", "dad")).toBe("owner");
    expect(owner("My friend Sam died.", "Sam")).toBe("owner");
    expect(owner("Sadly, mom passed away.", "mom")).toBe("owner");
  });
  it("someone else's: a possessive before or inside, after, \"of\", or another owner word", () => {
    expect(owner("My friend's mom passed away.", "mom")).toBe("other");
    expect(owner("My friend's mom passed away.", "friend's mom")).toBe("other");
    expect(owner("My friend’s mom passed away.", "mom")).toBe("other");
    expect(owner("Sam's dad died.", "dad")).toBe("other");
    expect(owner("Sam's dad died.", "Sam")).toBe("other");
    expect(owner("My mom's dog died.", "My mom")).toBe("other");
    expect(owner("The mom of my friend died.", "mom")).toBe("other");
    expect(owner("His mom died.", "mom")).toBe("other");
    expect(owner("A mom at school died.", "mom")).toBe("other");
    expect(owner("My parents' dog died.", "dog")).toBe("other");
  });
  it("a comma ends the phrase, so a word before it isn't read as the owner", () => {
    expect(owner("For his sake, mom is fine.", "mom")).toBe("owner");
  });
});

describe("occurrences", () => {
  it("every whole-word place, and a possessive form too (so the possessive test sees it)", () => {
    expect(occurrences("My mom and my mom's dog.", "mom").length).toBe(2);
    expect(occurrences("Momentum.", "mom")).toEqual([]);
  });
});

describe("ownerWordsSettle", () => {
  const ev = (text: string) => turnEvidenceOf(buildEvidence(TURN_EID, text, [], ["U"], TURN_AT), TURN_EID);
  const whole = (text: string) => spanAt(TURN_EID, text, 0, text.length - 1);
  it("an entityId alone counts only where its name stands in the span as the owner's", () => {
    const yes = "My dad passed away.";
    expect(ownerWordsSettle({ subject: { entityId: DAD, mention: null, isSelf: false }, span: whole(yes), evidence: ev(yes), known: KNOWN, entities: ENTITIES })).toBe(true);
    const no = "My friend's dad passed away.";
    expect(ownerWordsSettle({ subject: { entityId: DAD, mention: null, isSelf: false }, span: whole(no), evidence: ev(no), known: KNOWN, entities: ENTITIES })).toBe(false);
    const none = "He passed away.";
    expect(ownerWordsSettle({ subject: { entityId: DAD, mention: null, isSelf: false }, span: whole(none), evidence: ev(none), known: KNOWN, entities: ENTITIES })).toBe(false);
  });
});

describe("lifeMentionOwned", () => {
  it("needs the span's words to be the mention's name and the owner's phrase", () => {
    const t = "My dad passed away.";
    expect(lifeMentionOwned({ text: t, start: 3, end: 6 }, "dad")).toBe(true);
    expect(lifeMentionOwned({ text: t, start: 3, end: 6 }, "mom")).toBe(false);
    expect(lifeMentionOwned(null, "dad")).toBe(false);
  });
});

describe("\"'s\" as \"is\" or \"has\"", () => {
  it("reads the word after it", () => {
    expect(owner("My mom's in the hospital.", "mom")).toBe("owner");
    expect(owner("My mom's in the hospital.", "My mom")).toBe("owner");
    expect(owner("My dad's been ill.", "dad")).toBe("owner");
    expect(owner("My mom's dog died.", "mom")).toBe("other");
    expect(owner("It was my mom's.", "mom")).toBe("other");
  });
});
