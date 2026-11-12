import { describe, expect, it } from "vitest";
import { sampleMemory } from "../testing/samples";
import { OPEN_LEASE_MS } from "./constants";
import { applyTransitions, planTick, sourceVerdict, type TickRow } from "./tick";

const H = 3_600_000;
const row = (id: string, kind: TickRow["kind"], dueAt: number, closeAt: number, status: TickRow["status"] = "pending", leaseUntil: number | null = null): TickRow => ({ id, kind, status, dueAt, closeAt, leaseUntil });
const tick = (rows: TickRow[], worldNow: number, opts: { ops?: number; source?: (id: string) => "ok" | "gone" | "forgotten"; passes?: (id: string) => boolean } = {}) =>
  planTick({ rows, worldNow, opsNow: opts.ops ?? 0, source: opts.source ?? (() => "ok"), passes: opts.passes ?? (() => true) });

describe("planTick", () => {
  it("opens due moments in (dueAt, id) order and leaves later ones", () => {
    const ts = tick([row("b", "checkIn", 2 * H, 9 * H), row("a", "wish", 1 * H, 5 * H), row("c", "checkIn", 7 * H, 9 * H)], 3 * H);
    expect(ts).toEqual([
      { momentId: "a", to: "leased", why: "due" },
      { momentId: "b", to: "leased", why: "due" },
    ]);
  });

  it("a wish whose start has passed is opened, then skipped; others expire", () => {
    expect(tick([row("w", "wish", 1 * H, 5 * H), row("c", "checkIn", 2 * H, 4 * H)], 6 * H)).toEqual([
      { momentId: "w", to: "leased", why: "due" },
      { momentId: "w", to: "skipped", why: "startPassed" },
      { momentId: "c", to: "leased", why: "due" },
      { momentId: "c", to: "expired", why: "closed" },
    ]);
  });

  it("a gone or forgotten source cancels; a celebrate that misses is skipped silently", () => {
    const ts = tick([row("g", "checkIn", 1 * H, 9 * H), row("f", "checkIn", 1 * H, 9 * H), row("l", "celebrate", 1 * H, 9 * H)], 2 * H, {
      source: (id) => (id === "g" ? "gone" : id === "f" ? "forgotten" : "ok"),
      passes: () => false,
    });
    expect(ts).toEqual([
      { momentId: "f", to: "cancelled", why: "forgotten" },
      { momentId: "g", to: "cancelled", why: "policy" },
      { momentId: "l", to: "skipped", why: "predicateMiss" },
    ]);
  });

  it("an expired lease returns to pending and reopens; an admitted moment expires at close (Q35)", () => {
    expect(tick([row("x", "checkIn", 1 * H, 9 * H, "leased", 100)], 2 * H, { ops: 200 })).toEqual([
      { momentId: "x", to: "pending", why: "leaseExpired" },
      { momentId: "x", to: "leased", why: "due" },
    ]);
    expect(tick([row("y", "checkIn", 1 * H, 3 * H, "admitted")], 4 * H)).toEqual([{ momentId: "y", to: "expired", why: "closed" }]);
    const applied = applyTransitions([row("z", "checkIn", 1 * H, 9 * H)], [{ momentId: "z", to: "leased", why: "due" }], 1000);
    expect(applied[0]).toMatchObject({ status: "leased", leaseUntil: 1000 + OPEN_LEASE_MS });
  });

  it("sourceVerdict: blocked is forgotten; history, dirty and unresolved are gone", () => {
    expect(sourceVerdict(null)).toBe("gone");
    expect(sourceVerdict(sampleMemory({ status: "blocked" }))).toBe("forgotten");
    expect(sourceVerdict(sampleMemory({ status: "history" }))).toBe("gone");
    expect(sourceVerdict(sampleMemory({ dirty: true }))).toBe("gone");
    expect(sourceVerdict(sampleMemory({ predicate: "event", time: null }))).toBe("gone");
    expect(sourceVerdict(sampleMemory())).toBe("ok");
  });
});
