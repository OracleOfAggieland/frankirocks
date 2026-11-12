/**
 * The main screen's memory surfaces (brief 020). Reads GET /api/memory through `readMemory` and keeps what the
 * pure view-model (`ui/memory-screen.ts`) makes of it. Read-only: it never writes, and a failed read keeps the
 * last good surfaces, or nothing.
 *
 *   - `refresh()` reads overview, lab, strip and receipt, on sign-in and after each answered typed line.
 *   - `onReply` runs the false "gone" check on Franki's lines (spec §5 line 54): with no forget receipt behind a
 *     "gone", the ask card shows. The control the contract runs then belongs to the forget lane: `goneControl` is
 *     its seam, and does nothing in this build.
 *   - The chip "What do you know about me?" also opens the readout (`openReadout`): every overview page, in order.
 */
import { type MemoryResponse, type SnapshotView, SNAPSHOT_FLOOR, SNAPSHOT_PAGE, falseGone } from "@franki/core";
import { COPY } from "../ui/copy";
import { type MemorySurfaces, NO_SURFACES, memorySurfaces } from "../ui/memory-screen";
import { type ApiClient, readMemory } from "./api";

export interface MemoryState {
  surfaces: MemorySurfaces;
  /** The overview pages behind the readout card, or null while it is closed. */
  readout: SnapshotView[] | null;
  /** The false "gone" ask is showing. */
  goneAsk: boolean;
}

export interface MemoryModelDeps {
  api: ApiClient;
  /** The seam to the control the false "gone" check runs (forget lane). Nothing in this build. */
  goneControl?: (answer: "yes" | "no") => void;
}

/** The chips on the main screen (code constants; spec §15). */
export const MAIN_CHIPS: readonly string[] = [COPY.memory.chips.whatDoYouKnow];

export class MemoryModel {
  private state: MemoryState = { surfaces: NO_SURFACES, readout: null, goneAsk: false };
  private listeners = new Set<() => void>();
  private generation = 0;

  constructor(private readonly deps: MemoryModelDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MemoryState => this.state;

  /** Reads the four views; a later refresh wins over an earlier one still in flight. */
  async refresh(): Promise<void> {
    const gen = ++this.generation;
    const read = async (view: "overview" | "lab" | "strip" | "receipt"): Promise<MemoryResponse | null> => {
      const r = await readMemory(this.deps.api, view);
      return r.ok ? r.body : null;
    };
    const [overview, lab, strip, receipt] = await Promise.all([read("overview"), read("lab"), read("strip"), read("receipt")]);
    if (gen !== this.generation) return;
    const next = memorySurfaces({ overview, lab, strip, receipt });
    const prev = this.state.surfaces;
    // A failed read keeps what the last good read showed for that surface.
    this.set({
      surfaces: {
        jar: overview === null ? prev.jar : next.jar,
        lab: lab === null ? prev.lab : next.lab,
        strip: strip === null ? prev.strip : next.strip,
        receipt: receipt === null ? prev.receipt : next.receipt,
      },
    });
  }

  /** Reads every overview page in order for the readout card, up to the snapshot's floor. */
  async openReadout(): Promise<void> {
    const pages: SnapshotView[] = [];
    let cursor: string | null = null;
    for (let i = 0; i * SNAPSHOT_PAGE < SNAPSHOT_FLOOR; i++) {
      const r = await readMemory(this.deps.api, "overview", { cursor });
      if (!r.ok || r.body.snapshot === null) break;
      pages.push(r.body.snapshot);
      cursor = r.body.snapshot.cursor;
      if (cursor === null) break;
    }
    if (pages.length > 0) this.set({ readout: pages });
  }

  closeReadout(): void {
    this.set({ readout: null });
  }

  /** One answered typed line: the false "gone" check, then a fresh read. */
  onReply(reply: { transcript: string; lines: string[]; receiptId: string | null }): void {
    if (falseGone(reply.lines, reply.receiptId)) this.set({ goneAsk: true });
    void this.refresh();
  }

  answerGone(answer: "yes" | "no"): void {
    this.set({ goneAsk: false });
    this.deps.goneControl?.(answer);
  }

  /** Signed out or forgotten: drop everything this client holds. */
  clear(): void {
    this.generation++;
    this.set({ surfaces: NO_SURFACES, readout: null, goneAsk: false });
  }

  private set(patch: Partial<MemoryState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}
