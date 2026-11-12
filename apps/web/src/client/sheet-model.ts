/**
 * The "What I know" sheet on real data (brief 027). Reads GET /api/memory: every `overview` page for the rows, then
 * the `why` view of each row for where it came from; `openItem` reads one row through the `item` view. The rows are
 * what the pure `ui/known-items.ts` keeps of those answers, and nothing else. Read-only.
 */
import { type InspectItem, SNAPSHOT_FLOOR, SNAPSHOT_PAGE, type SnapshotView } from "@franki/core";
import { knownItemFrom, knownItems } from "../ui/known-items";
import type { KnownItem } from "../ui/surface-props";
import { type ApiClient, readMemory } from "./api";

/** At most this many why reads at once. A ruling: one named constant. */
export const SHEET_WHY_CONCURRENCY = 4;
/** Why is read for at most this many rows; the rest show where they came from as not shown. */
export const SHEET_WHY_MAX = 50;

export interface SheetState {
  open: boolean;
  loading: boolean;
  /** The overview read failed: the sheet says so and shows no rows. */
  failed: boolean;
  items: KnownItem[];
}

export const CLOSED_SHEET: SheetState = { open: false, loading: false, failed: false, items: [] };

export class SheetModel {
  private state: SheetState = CLOSED_SHEET;
  private listeners = new Set<() => void>();
  private generation = 0;

  constructor(private readonly deps: { api: ApiClient }) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SheetState => this.state;

  /** Opens the sheet on everything the overview shows. */
  async open(): Promise<void> {
    const gen = ++this.generation;
    this.set({ open: true, loading: true, failed: false, items: [] });
    const pages: SnapshotView[] = [];
    let cursor: string | null = null;
    let failed = false;
    for (let i = 0; i * SNAPSHOT_PAGE < SNAPSHOT_FLOOR; i++) {
      const r = await readMemory(this.deps.api, "overview", { cursor });
      if (!r.ok || r.body.snapshot === null) {
        failed = pages.length === 0;
        break;
      }
      pages.push(r.body.snapshot);
      cursor = r.body.snapshot.cursor;
      if (cursor === null) break;
    }
    if (gen !== this.generation) return;
    if (failed) return this.set({ loading: false, failed: true, items: [] });
    const ids = [...new Set(pages.flatMap((p) => p.cards.map((c) => c.id)))].slice(0, SHEET_WHY_MAX);
    const whys = new Map<string, readonly InspectItem[] | null>();
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++]!;
        whys.set(id, await this.why(id));
      }
    };
    await Promise.all(Array.from({ length: Math.min(SHEET_WHY_CONCURRENCY, ids.length) }, worker));
    if (gen !== this.generation) return;
    this.set({ loading: false, failed: false, items: knownItems(pages, whys) });
  }

  /** Opens the sheet on one row, through the `item` view. */
  async openItem(id: string): Promise<void> {
    const gen = ++this.generation;
    this.set({ open: true, loading: true, failed: false, items: [] });
    const [item, why] = await Promise.all([readMemory(this.deps.api, "item", { id }), this.why(id)]);
    if (gen !== this.generation) return;
    if (!item.ok) return this.set({ loading: false, failed: true, items: [] });
    this.set({ loading: false, failed: false, items: knownItemFrom(item.body.items, why) });
  }

  close(): void {
    this.generation++;
    this.set(CLOSED_SHEET);
  }

  /** Signed out, forgotten or reset: drop every row this client holds. */
  clear(): void {
    this.close();
  }

  private async why(id: string): Promise<readonly InspectItem[] | null> {
    const r = await readMemory(this.deps.api, "why", { id });
    return r.ok ? r.body.items : null;
  }

  private set(patch: Partial<SheetState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}
