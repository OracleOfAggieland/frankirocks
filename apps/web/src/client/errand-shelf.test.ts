import { describe, expect, it } from "vitest";
import { COPY } from "../ui/copy";
import { NO_ERRANDS_SHOWN, errandCardProps, errandWord } from "../ui/errands/errand-view";
import { ErrandShelf } from "./errand-shelf";

const stamp = { sessionId: "s1", generation: 1 };
const card = { id: "c1", kind: "source" as const, title: "From your mail", lines: ["From Dana, today: Thursday at 9."], sources: [], sens: "S0" as const };

describe("errand shelf (brief 049 part A)", () => {
  it("shows the running word and the cards of the call's own Session, and tells listeners only on a change", () => {
    const shelf = new ErrandShelf();
    let told = 0;
    shelf.subscribe(() => told++);
    shelf.onState(stamp, { running: ["mail"], cards: [] });
    shelf.onState(stamp, { running: ["mail"], cards: [] });
    expect(told).toBe(1);
    expect(errandWord(shelf.getSnapshot())).toBe(COPY.errands.running.mail);
    shelf.onState(stamp, { running: [], cards: [card] });
    expect(errandWord(shelf.getSnapshot())).toBeNull();
    expect(errandCardProps(shelf.getSnapshot()).map((c) => (c.kind === "read" ? c.lines : null))).toEqual([card.lines]);
  });

  it("a server without errands answers none; another Session clears; between calls only the word goes", () => {
    const shelf = new ErrandShelf();
    shelf.onState(stamp, undefined);
    expect(shelf.getSnapshot().cards).toEqual([]);
    shelf.onState(stamp, { running: ["mail", "calendar"], cards: [card] });
    expect(errandWord(shelf.getSnapshot())).toBe(COPY.errands.running.both);
    shelf.onVoice({ session: null });
    expect(shelf.getSnapshot().running).toEqual([]);
    expect(shelf.getSnapshot().cards).toHaveLength(1);
    shelf.onVoice({ session: { sessionId: "s2", generation: 1 } });
    expect(shelf.getSnapshot()).toBe(NO_ERRANDS_SHOWN);
  });
});
