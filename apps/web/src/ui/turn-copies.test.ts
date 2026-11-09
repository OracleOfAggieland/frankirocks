import { describe, expect, it } from "vitest";
import type { ApiClient } from "../client/api";
import type { BrowserClock } from "../client/clock";
import { TypedTurns } from "../client/typed-turns";
import { clearTurnCopies, latestReply } from "./turn-copies";

describe("latestReply", () => {
  it("joins Franki's entries after the last user entry", () => {
    expect(
      latestReply([
        { role: "user", text: "hi" },
        { role: "franki", text: "Hello." },
        { role: "user", text: "my dog is Pip" },
        { role: "franki", text: "Noted." },
        { role: "franki", text: "Pip it is." },
      ]),
    ).toBe("Noted. Pip it is.");
  });

  it("is null with no reply after the last line", () => {
    expect(latestReply([])).toBeNull();
    expect(latestReply([{ role: "franki", text: "Old." }, { role: "user", text: "new" }])).toBeNull();
  });
});

describe("clearTurnCopies", () => {
  it("empties every copy", () => {
    expect(
      clearTurnCopies({
        reply: "x",
        caption: { id: "c", text: "y" },
        typedText: "z",
        cards: [{ kind: "read", id: "r", title: "t", sources: [], onOpenSource: () => {}, lines: ["a"] }],
        jarItems: [{ id: "j", area: "Goals", text: "t", from: "f", guessed: false, hardRule: false }],
      }),
    ).toEqual({ reply: null, caption: null, typedText: "", cards: [], jarItems: [] });
  });
});

describe("TypedTurns.dropTurnCopies", () => {
  it("empties entries and text and tells subscribers", () => {
    const turns = new TypedTurns({ api: {} as ApiClient, clock: {} as BrowserClock });
    turns.setText("my dog is Pip");
    let told = 0;
    turns.subscribe(() => told++);
    turns.dropTurnCopies();
    expect(turns.getSnapshot().text).toBe("");
    expect(turns.getSnapshot().entries).toEqual([]);
    expect(told).toBe(1);
  });
});
