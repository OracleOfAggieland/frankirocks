import { describe, expect, it } from "vitest";
import { PROACTIVE_ANSWER } from "../../app/specimens/_fixtures/visit";
import { latestReply } from "../turn-copies";
import { proactiveCards, replyEntries } from "./proactive-view";

const typed = [
  { key: "u", role: "user" as const, text: "Biscuit has surgery Thursday." },
  { key: "f", role: "franki" as const, text: "I hope it goes well." },
];
const shown = { key: "p", text: PROACTIVE_ANSWER.whisper.text, cards: PROACTIVE_ANSWER.cards, atEntries: 2 };

describe("proactive view", () => {
  it("is the latest reply on its own until the next typed line", () => {
    expect(latestReply(replyEntries(typed, shown))).toBe("How'd Biscuit do?");
    expect(replyEntries(typed, shown).length).toBe(4);
    const later = [...typed, { key: "u2", role: "user" as const, text: "Fine." }, { key: "f2", role: "franki" as const, text: "Good." }];
    expect(latestReply(replyEntries(later, shown))).toBe("Good.");
    expect(replyEntries(typed, null)).toBe(typed);
  });

  it("shows its cards as read cards, with no actions", () => {
    expect(proactiveCards(shown)).toEqual([expect.objectContaining({ kind: "read", title: "Biscuit's surgery", lines: ["You said Thursday."], sources: [] })]);
    expect(proactiveCards(null)).toEqual([]);
  });
});
