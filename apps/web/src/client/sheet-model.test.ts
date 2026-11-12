import { MemoryResponse, validate } from "@franki/core";
import { describe, expect, it } from "vitest";
import { FIXTURE_MEMORY, FIXTURE_SNAPSHOT, fixtureItem, fixtureWhy } from "../app/specimens/_fixtures/memory";
import { COPY } from "../ui/copy";
import { type FetchLike, createApiClient } from "./api";
import { SheetModel } from "./sheet-model";

function harness(answer: (view: string, id: string | null) => Response) {
  const seen: string[] = [];
  const fetch: FetchLike = async (url) => {
    seen.push(url);
    const q = new URL(url, "http://x").searchParams;
    return answer(q.get("view") ?? "", q.get("id"));
  };
  return { model: new SheetModel({ api: createApiClient({ getToken: async () => "tok", fetch }) }), seen };
}

const honest = (view: string, id: string | null) =>
  Response.json(view === "overview" ? FIXTURE_MEMORY.overview : view === "why" ? fixtureWhy(id ?? "") : view === "item" ? fixtureItem(id ?? "") : FIXTURE_MEMORY.lab);

describe("SheetModel", () => {
  it("fixtures are valid answers", () => {
    for (const c of FIXTURE_SNAPSHOT.cards) {
      expect(validate(MemoryResponse, fixtureWhy(c.id)).ok).toBe(true);
      expect(validate(MemoryResponse, fixtureItem(c.id)).ok).toBe(true);
    }
  });

  it("opens on every overview row, each with where it came from", async () => {
    const h = harness(honest);
    await h.model.open();
    const s = h.model.getSnapshot();
    expect(s).toMatchObject({ open: true, loading: false, failed: false });
    expect(s.items.map((i) => i.id)).toEqual(FIXTURE_SNAPSHOT.cards.map((c) => c.id));
    expect(s.items[0]).toMatchObject({ text: "fact: Biscuit has surgery Thursday", from: "You said", area: null });
    expect(s.items.find((i) => i.text.includes("bakery"))!.from).toBe("An email");
    expect(s.items.find((i) => i.text.includes("gap year"))!.from).toBe(COPY.sheetData.fromUnknown);
    expect(h.seen.filter((u) => u.includes("view=why"))).toHaveLength(FIXTURE_SNAPSHOT.cards.length);
  });

  it("drops a row whose why answer no longer names it, and keeps one whose why read failed", async () => {
    const [gone, failed] = [FIXTURE_SNAPSHOT.cards[0]!.id, FIXTURE_SNAPSHOT.cards[1]!.id];
    const h = harness((view, id) => {
      if (view === "why" && id === gone) return Response.json({ ...FIXTURE_MEMORY.overview, snapshot: null, items: [] });
      if (view === "why" && id === failed) return Response.json({ error: "DEPENDENCY", retryAfterMs: 0 }, { status: 503 });
      return honest(view, id);
    });
    await h.model.open();
    const items = h.model.getSnapshot().items;
    expect(items.map((i) => i.id)).not.toContain(gone);
    expect(items.find((i) => i.id === failed)!.from).toBe(COPY.sheetData.fromUnknown);
  });

  it("a failed overview shows no rows and says it failed", async () => {
    const h = harness(() => Response.json({ error: "BARRIER", retryAfterMs: 0 }, { status: 423 }));
    await h.model.open();
    expect(h.model.getSnapshot()).toMatchObject({ open: true, loading: false, failed: true, items: [] });
  });

  it("openItem shows the one row the item view returned", async () => {
    const h = harness(honest);
    const id = FIXTURE_SNAPSHOT.cards[2]!.id;
    await h.model.openItem(id);
    expect(h.model.getSnapshot().items).toEqual([{ id, area: null, text: "fact: I work at the bakery", from: "An email", guessed: false, hardRule: false }]);
    await h.model.openItem("x".repeat(43));
    expect(h.model.getSnapshot().items).toEqual([]);
  });

  it("close drops a read still in flight", async () => {
    const h = harness(honest);
    const p = h.model.open();
    h.model.close();
    await p;
    expect(h.model.getSnapshot()).toEqual({ open: false, loading: false, failed: false, items: [] });
  });
});
