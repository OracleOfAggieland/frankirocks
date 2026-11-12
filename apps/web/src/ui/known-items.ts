// The "What I know" sheet's rows from GET /api/memory (brief 027). Pure: the route's answers go in, the sheet's
// items come out, and nothing the route did not return. The route decides what may be shown (brief 020's `shown()`);
// this file only keeps it, in the overview's order, one row per card.
//
// Not filled, because no view carries them: the area (no predicate-to-area source, so every row is unsorted),
// guesses (counts only on the wire) and hard rules (no view reads core/rules).
import type { Card, InspectItem, SnapshotView } from "@franki/core";
import { COPY } from "./copy";
import type { KnownItem } from "./surface-props";

/** A why read per card: the route's items, or null when the read failed. A card with no entry was not read. */
export type WhyReads = ReadonlyMap<string, readonly InspectItem[] | null>;

/** The card's words: its first line, else its title. */
const cardText = (c: Pick<Card, "title" | "lines">) => c.lines[0] ?? c.title;

/** Where a row came from: the why view's source labels, or the fixed words when it shows none. */
function fromOf(items: readonly InspectItem[] | null | undefined): string {
  if (items === null || items === undefined) return COPY.sheetData.fromUnknown;
  const labels = [...new Set(items.filter((i) => i.kind === "evidence" && i.label !== "").map((i) => i.label))];
  return labels.length > 0 ? labels.join(", ") : COPY.sheetData.fromUnknown;
}

/** A why answer that no longer names its row says the route no longer shows it. */
const stillShown = (id: string, items: readonly InspectItem[] | null | undefined) =>
  items === null || items === undefined || items.some((i) => i.id === id && i.kind === "memory");

export function knownItems(pages: readonly SnapshotView[], whys: WhyReads): KnownItem[] {
  const out: KnownItem[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    for (const c of p.cards) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const why = whys.get(c.id);
      if (!stillShown(c.id, why)) continue;
      out.push({ id: c.id, area: null, text: cardText(c), from: fromOf(why), guessed: false, hardRule: false });
    }
  }
  return out;
}

/** One row from the `item` view and its `why`: the item's own words, or nothing when the route shows none. */
export function knownItemFrom(items: readonly InspectItem[], why: readonly InspectItem[] | null): KnownItem[] {
  const item = items.find((i) => i.kind === "memory");
  if (item === undefined || !stillShown(item.id, why)) return [];
  return [{ id: item.id, area: null, text: item.body, from: fromOf(why), guessed: false, hardRule: false }];
}
